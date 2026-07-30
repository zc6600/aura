import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import picocolors from 'picocolors';
import { Client } from '../../core/llm/client.js';
import * as Env from '../../core/llm/env.js';
import type { ChatMessage } from '../../core/llm/types.js';
import {
  importLegacyChatHistory,
  legacyChatHistoryPath,
} from '../../core/memory/legacyChatImport.js';
import {
  MemoryProvider,
  type TranscriptMessage,
} from '../../core/memory/provider.js';
import { MemoryRecorder } from '../../core/memory/recorder.js';
import { SQLiteStore } from '../../core/memory/sqliteStore.js';
import * as ConfigManager from '../../utils/configManager.js';
import type { AuraConfig } from '../../utils/configSchema.js';
import * as GlobalConfig from '../../utils/globalConfig.js';
import * as PathResolver from '../../utils/pathResolver.js';
import * as UI from '../ui.js';

interface ChatReadline extends readline.Interface {
  closed?: boolean;
}

/** How many past messages are replayed to the model on each turn. */
const CONTEXT_MESSAGE_LIMIT = 10;

/**
 * Chat's view onto a session's shared event log.
 *
 * Chat used to keep a flat JSON transcript of its own, invisible to every
 * other execution path. It now reads and writes the same SQLite event log the
 * agent uses, so a human turn and an autonomous turn land on one timeline.
 * What stays chat-specific is the *context*: this only ever replays plain
 * user/assistant messages, never tool output or context providers.
 */
class ChatHistory {
  public readonly dbPath: string;
  private store: SQLiteStore | null = null;
  private pendingNotice: string | null = null;

  constructor(
    private readonly stateDir: string,
    public readonly sessionName: string,
  ) {
    this.dbPath = path.join(stateDir, 'sessions', `${sessionName}.db`);
  }

  /**
   * Opening a store creates the database file, so read-only callers pass
   * `create: false` to avoid littering empty sessions across the workspace
   * just because someone ran `chat context` on a name that does not exist.
   */
  private open(create: boolean): SQLiteStore | null {
    if (this.store) return this.store;

    const hasHistory =
      fs.existsSync(this.dbPath) ||
      fs.existsSync(legacyChatHistoryPath(this.stateDir, this.sessionName));
    if (!create && !hasHistory) return null;

    this.store = new SQLiteStore({ dbPath: this.dbPath });

    const migration = importLegacyChatHistory(
      this.store,
      this.stateDir,
      this.sessionName,
    );
    if (migration.skippedReason === 'session-not-empty') {
      this.pendingNotice =
        `⚠️ Legacy chat history at ${migration.legacyPath} was left in place: ` +
        `session '${this.sessionName}' already has events, and replaying old turns would misorder the timeline.`;
    } else if (migration.skippedReason === 'unreadable') {
      this.pendingNotice = `⚠️ Could not read legacy chat history at ${migration.legacyPath}; it was left untouched.`;
    }

    return this.store;
  }

  /** Emits any one-time migration warning; safe to call repeatedly. */
  public flushNotice(): void {
    if (this.pendingNotice) {
      console.warn(picocolors.yellow(this.pendingNotice));
      this.pendingNotice = null;
    }
  }

  public messages(limit?: number): TranscriptMessage[] {
    const store = this.open(false);
    if (!store) return [];
    this.flushNotice();
    return new MemoryProvider(store).toChatMessages({ limit });
  }

  public appendTurn(userContent: string, assistantContent: string): void {
    const store = this.open(true);
    if (!store) return;
    const recorder = new MemoryRecorder(store);
    store.transaction(() => {
      // Tying the reply to the user event id matches how the kernel groups a
      // turn (see Runner.recordExecution), keeping undo and metabolism honest.
      const userEventId = recorder.recordUser(userContent);
      recorder.recordAssistant(assistantContent, userEventId);
    });
  }

  public clear(): void {
    this.open(false)?.clearHistory();
  }

  public undo(): boolean {
    return this.open(false)?.undoLastTurn() ?? false;
  }

  public close(): void {
    try {
      this.store?.close();
    } catch {
      // A failed close only matters at process exit, where it is harmless.
    }
    this.store = null;
  }
}

export class Chat {
  public static async run(
    question?: string,
    options: {
      model?: string;
      provider?: string;
      system?: string;
      session?: string;
      clear?: boolean;
    } = {},
  ): Promise<void> {
    const auraDir = PathResolver.findAuraDir(process.cwd());
    const cfgPath = PathResolver.resolveConfigPath(
      auraDir || GlobalConfig.repoPath(),
    );

    let cfg: AuraConfig = {};
    if (cfgPath && fs.existsSync(cfgPath)) {
      try {
        cfg = ConfigManager.loadTyped(auraDir || GlobalConfig.repoPath());
      } catch (e: unknown) {
        console.warn(
          picocolors.yellow(
            `⚠️ Warning: Failed to load configuration: ${(e as Error).message}`,
          ),
        );
      }
    }

    // Determine provider, model, temperature
    let provider = options.provider || cfg.llm?.provider || 'local';
    const _apiBase = cfg.llm?.api_base;
    let model = options.model || cfg.llm?.model;
    const temp =
      cfg.llm?.temperature !== undefined ? Number(cfg.llm.temperature) : 0.7;
    const maxTokens = cfg.llm?.max_tokens;

    // Load API keys
    const projectPath = auraDir ? path.dirname(auraDir) : process.cwd();
    Env.loadFrom(projectPath);
    let apiKey = Env.resolveApiKey(provider);

    // Resolve history session file
    const stateDir = auraDir
      ? path.join(auraDir, 'state')
      : path.join(GlobalConfig.repoPath(), 'state');
    let sessionName = options.session || 'default';

    // Sanitize session name
    try {
      sessionName = PathResolver.sanitizeSessionName(sessionName);
      PathResolver.assertSessionNameNotReserved(sessionName);
    } catch (e: unknown) {
      throw new UI.CliError(`Invalid session name: ${(e as Error).message}`);
    }
    let chatHistory = new ChatHistory(stateDir, sessionName);

    if (options.clear) {
      try {
        chatHistory.clear();
        console.log(
          picocolors.yellow(`Memory cleared for session '${sessionName}'.`),
        );
      } catch (e: unknown) {
        console.warn(
          picocolors.yellow(
            `⚠️ Warning: Failed to clear session history: ${(e as Error).message}`,
          ),
        );
      }
    }

    // --- Single question context printing ---
    if (question && question.trim().toLowerCase() === 'context') {
      Chat.printHistory(chatHistory.messages(), sessionName);
      chatHistory.close();
      return;
    }

    // --- Interactive loop ---
    if (!question || question.trim().length === 0) {
      const llmCfg = { ...(cfg.llm || {}) };
      if (options.provider) llmCfg.provider = options.provider;
      if (options.model) llmCfg.model = options.model;

      let client = Client.fromConfig(llmCfg, projectPath);

      const completer = (line: string) => {
        const commands = [
          '/exit',
          '/quit',
          '/clear',
          '/context',
          '/history',
          '/model',
          '/provider',
          '/session',
          '/settings',
          '/undo',
          '/help',
        ];
        const hits = commands.filter((c) => c.startsWith(line));
        return [hits.length ? hits : commands, line];
      };

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer,
      }) as ChatReadline;

      console.log(
        `🤖 Pure chat session started (no tools/context). Session: ${picocolors.yellow(sessionName)}`,
      );
      console.log(
        'Type /exit or /quit to end, /clear to clear memory, /context to view history. Type /help for all commands.\n',
      );

      rl.setPrompt('chat> ');
      rl.prompt();

      let multilineMode = false;
      let buffer: string[] = [];

      let isClosed = false;
      await new Promise<void>((resolve) => {
        const processInput = async (inputStr: string): Promise<boolean> => {
          if (inputStr.length === 0) return false;

          if (
            inputStr.startsWith('/') ||
            [
              'exit',
              'quit',
              'q',
              'clear',
              'context',
              'help',
              'settings',
              'undo',
            ].includes(inputStr.toLowerCase())
          ) {
            const parts = inputStr.split(/\s+/);
            const cmd = parts[0].toLowerCase();
            const args = parts.slice(1).join(' ');

            if (['exit', 'quit', 'q', '/exit', '/quit', '/q'].includes(cmd)) {
              console.log('Bye!');
              isClosed = true;
              rl.close();
              return true;
            }

            if (['clear', '/clear', '/c'].includes(cmd)) {
              try {
                chatHistory.clear();
                console.log(
                  picocolors.yellow(
                    `Memory cleared for session '${sessionName}'.`,
                  ),
                );
                console.log(
                  picocolors.dim(
                    '   (sessions are shared with the agent — any agent turns in this session were cleared too)',
                  ),
                );
              } catch (e: unknown) {
                console.warn(
                  picocolors.yellow(
                    `⚠️ Warning: Failed to clear session history: ${(e as Error).message}`,
                  ),
                );
              }
              return false;
            }

            if (['context', '/context', '/history'].includes(cmd)) {
              Chat.printHistory(chatHistory.messages(), sessionName);
              return false;
            }

            if (['undo', '/undo'].includes(cmd)) {
              if (chatHistory.undo()) {
                console.log('✅ Undid last turn.');
              } else {
                console.log(picocolors.yellow('⚠️ Nothing to undo.'));
              }
              return false;
            }

            if (['settings', '/settings'].includes(cmd)) {
              let maskedKey = picocolors.red('Missing');
              if (apiKey?.trim()) {
                maskedKey =
                  apiKey.trim().length <= 8
                    ? picocolors.green('Present (masked: ****)')
                    : picocolors.green(
                        `Present (masked: ${apiKey.trim().substring(0, 4)}...${apiKey.trim().substring(apiKey.trim().length - 4)})`,
                      );
              }
              const stored = chatHistory.messages();
              console.log('Current Chat Settings:');
              console.log(
                `  Active Session:  ${picocolors.yellow(sessionName)} (stored in: ${chatHistory.dbPath})`,
              );
              console.log(
                `  History size:    ${Math.floor(stored.length / 2)} turns (${stored.length} messages)`,
              );
              console.log(`  LLM Provider:    ${picocolors.yellow(provider)}`);
              console.log(
                `  LLM Model:       ${picocolors.yellow(model || 'default')}`,
              );
              console.log(`  API Key:         ${maskedKey}`);
              console.log(`  Config File:     ${cfgPath}`);
              return false;
            }

            if (['help', '/help', '/h'].includes(cmd)) {
              console.log('Available commands:');
              console.log('  /exit or /quit   - Exit the chat session');
              console.log('  /clear           - Clear conversation history');
              console.log('  /context         - Show conversation history');
              console.log('  /model <name>    - Switch LLM model');
              console.log('  /provider <name> - Switch provider');
              console.log('  /session <name>  - Switch conversation session');
              console.log('  /settings        - Show current chat settings');
              console.log(
                '  /undo            - Undo last turn (removes from memory)',
              );
              console.log('  /help            - Show this help');
              return false;
            }

            if (cmd === '/model') {
              if (args.trim().length === 0) {
                console.log(`Current model: ${model || 'default'}`);
                console.log('Usage: /model <model_name>');
              } else {
                model = args.trim();
                llmCfg.model = model;
                client = Client.fromConfig(llmCfg, projectPath);
                console.log(`Model switched to: ${picocolors.yellow(model)}`);
              }
              return false;
            }

            if (cmd === '/provider') {
              if (args.trim().length === 0) {
                console.log(`Current provider: ${provider}`);
                console.log('Usage: /provider <provider_name>');
              } else {
                provider = args.trim();
                llmCfg.provider = provider;
                delete llmCfg.api_key;
                delete llmCfg.api_key_env;
                apiKey = Env.resolveApiKey(provider);
                client = Client.fromConfig(llmCfg, projectPath);
                console.log(
                  `Provider switched to: ${picocolors.yellow(provider)}`,
                );
              }
              return false;
            }

            if (['/session', '/s'].includes(cmd)) {
              if (args.trim().length === 0) {
                console.log(
                  `Current session: ${picocolors.yellow(sessionName)}`,
                );
                console.log('Usage: /session <session_name>');
              } else {
                try {
                  const newSess = PathResolver.sanitizeSessionName(args.trim());
                  PathResolver.assertSessionNameNotReserved(newSess);
                  chatHistory.close();
                  sessionName = newSess;
                  chatHistory = new ChatHistory(stateDir, sessionName);
                  console.log(
                    `Switched to session: ${picocolors.yellow(sessionName)}`,
                  );
                } catch (e: unknown) {
                  console.error(
                    picocolors.red(
                      `⛔️ Error: Invalid session name: ${(e as Error).message}`,
                    ),
                  );
                }
              }
              return false;
            }

            console.log(`Unknown command: ${cmd}`);
            return false;
          }

          const messages: ChatMessage[] = chatHistory
            .messages(CONTEXT_MESSAGE_LIMIT)
            .map((msg) => ({ role: msg.role, content: msg.content }));

          const systemInstruction = options.system || '';
          const qContent = systemInstruction
            ? `System Instruction: ${systemInstruction}\n\n${inputStr}`
            : inputStr;
          messages.push({ role: 'user', content: qContent });

          // Show inline status — cleared by \r\x1b[K when first token arrives
          process.stdout.write(
            picocolors.dim(`⏳ ${provider}/${model || 'default'}...`),
          );

          let responseText = '';
          let firstToken = true;
          const t0 = Date.now();
          try {
            await client.completeStream(
              messages,
              { temperature: temp, max_tokens: maxTokens },
              (delta) => {
                if (firstToken) {
                  // Erase the "Connecting..." line, print a model tag header
                  process.stdout.write(
                    `\r\x1b[K${picocolors.dim(`[${provider}/${model || 'default'}]`)} `,
                  );
                  firstToken = false;
                }
                process.stdout.write(delta);
                responseText += delta;
              },
            );
            const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
            console.log(`\n${picocolors.dim(`(${elapsed}s)`)}\n`);

            if (responseText.trim().length > 0) {
              try {
                chatHistory.appendTurn(inputStr, responseText);
              } catch (e: unknown) {
                console.warn(
                  picocolors.yellow(
                    `⚠️ Warning: Failed to save session history: ${(e as Error).message}`,
                  ),
                );
              }
            }
          } catch (e: unknown) {
            process.stdout.write('\r\x1b[K'); // clear status line on error
            console.error(
              picocolors.red(`\n⛔️ Error calling LLM: ${(e as Error).message}`),
            );
          }
          return false;
        };

        rl.on('line', async (line) => {
          rl.pause();
          const input = line.trim();
          let shouldExit = false;

          if (multilineMode) {
            if (input.endsWith('\\')) {
              buffer.push(input.substring(0, input.length - 1));
              rl.resume();
              rl.setPrompt('....> ');
              rl.prompt();
              return;
            } else {
              buffer.push(input);
              const fullInput = buffer.join('\n').trim();
              buffer = [];
              multilineMode = false;
              shouldExit = await processInput(fullInput);
            }
          } else {
            if (input.endsWith('\\')) {
              buffer.push(input.substring(0, input.length - 1));
              multilineMode = true;
              rl.resume();
              rl.setPrompt('....> ');
              rl.prompt();
              return;
            } else {
              shouldExit = await processInput(input);
            }
          }

          if (shouldExit || isClosed || rl.closed) {
            resolve();
            return;
          }

          try {
            if (!isClosed && !rl.closed) {
              rl.resume();
              rl.setPrompt('chat> ');
              rl.prompt();
            }
          } catch {}
        });

        rl.on('close', () => {
          isClosed = true;
          resolve();
        });
      });

      chatHistory.close();
      return;
    }

    // --- Single question mode ---
    const llmCfgSingle = { ...(cfg.llm || {}) };
    if (options.provider) llmCfgSingle.provider = options.provider;
    if (options.model) llmCfgSingle.model = options.model;
    const client = Client.fromConfig(llmCfgSingle, projectPath);
    const messages: ChatMessage[] = chatHistory
      .messages(CONTEXT_MESSAGE_LIMIT)
      .map((msg) => ({ role: msg.role, content: msg.content }));

    const systemInstruction = options.system || '';
    const qContent = systemInstruction
      ? `System Instruction: ${systemInstruction}\n\n${question}`
      : question;
    messages.push({ role: 'user', content: qContent });

    // Show inline status — cleared by \r\x1b[K when first token arrives
    process.stdout.write(
      picocolors.dim(`⏳ ${provider}/${model || 'default'}...`),
    );

    let responseText = '';
    let firstToken = true;
    const t0 = Date.now();
    try {
      await client.completeStream(
        messages,
        { temperature: temp, max_tokens: maxTokens },
        (delta) => {
          if (firstToken) {
            process.stdout.write(
              `\r\x1b[K${picocolors.dim(`[${provider}/${model || 'default'}]`)} `,
            );
            firstToken = false;
          }
          process.stdout.write(delta);
          responseText += delta;
        },
      );
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`\n${picocolors.dim(`(${elapsed}s)`)}`);

      if (responseText.trim().length > 0) {
        try {
          chatHistory.appendTurn(question, responseText);
        } catch (e: unknown) {
          console.warn(
            picocolors.yellow(
              `⚠️ Warning: Failed to save session history: ${(e as Error).message}`,
            ),
          );
        }
      }
    } catch (e: unknown) {
      process.stdout.write('\r\x1b[K');
      throw new UI.CliError(`Error calling LLM: ${(e as Error).message}`);
    } finally {
      chatHistory.close();
    }
  }

  private static printHistory(
    history: TranscriptMessage[],
    sessionName: string,
  ): void {
    if (history.length === 0) {
      console.log(
        `No conversation history found for session '${sessionName}'.`,
      );
      return;
    }

    console.log(`Conversation history for session '${sessionName}':`);
    console.log('='.repeat(50));
    history.forEach((msg, idx) => {
      const roleColor =
        msg.role === 'user'
          ? picocolors.green('User')
          : picocolors.blue('Assistant');
      console.log(`[${idx + 1}] ${roleColor}:`);
      console.log(msg.content);
      console.log('-'.repeat(50));
    });
  }
}

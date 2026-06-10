import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import picocolors from 'picocolors';
import yaml from 'yaml';
import * as PathResolver from '../../utils/pathResolver.js';
import * as GlobalConfig from '../../utils/globalConfig.js';
import * as Env from '../../core/llm/env.js';
import { Client } from '../../core/llm/client.js';

interface Message {
  role: string;
  content: string;
}

export class Ask {
  public static async run(question?: string, options: { model?: string; provider?: string; system?: string; session?: string; clear?: boolean } = {}): Promise<void> {
    const auraDir = PathResolver.findAuraDir(process.cwd());
    const cfgPath = PathResolver.resolveConfigPath(auraDir || GlobalConfig.repoPath());

    let cfg: any = {};
    if (fs.existsSync(cfgPath)) {
      try {
        cfg = yaml.parse(fs.readFileSync(cfgPath, 'utf-8')) || {};
      } catch {}
    }

    // Determine provider, model, temperature
    let provider = options.provider || cfg.llm?.provider || 'local';
    const apiBase = cfg.llm?.api_base;
    let model = options.model || cfg.llm?.model;
    const temp = cfg.llm?.temperature !== undefined ? Number(cfg.llm.temperature) : 0.7;
    const maxTokens = cfg.llm?.max_tokens;

    // Load API keys
    const projectPath = auraDir ? path.dirname(auraDir) : process.cwd();
    Env.loadFrom(projectPath);
    let apiKey = Env.resolveApiKey(provider);

    // Resolve history session file
    const stateDir = auraDir
      ? path.join(auraDir, 'state')
      : path.join(GlobalConfig.repoPath(), 'state');
    const sessionsDir = path.join(stateDir, 'ask_sessions');
    let sessionName = options.session || 'default';

    // Sanitize session name
    try {
      sessionName = PathResolver.sanitizeSessionName(sessionName);
    } catch (e: any) {
      console.error(picocolors.red(`⛔️ Error: Invalid session name: ${e.message}`));
      process.exit(1);
    }
    let historyFile = path.join(sessionsDir, `${sessionName}.json`);

    if (options.clear) {
      try {
        if (fs.existsSync(historyFile)) {
          fs.unlinkSync(historyFile);
        }
        console.log(picocolors.yellow(`Memory cleared for session '${sessionName}'.`));
      } catch {}
    }

    let history: Message[] = [];
    if (fs.existsSync(historyFile)) {
      try {
        history = JSON.parse(fs.readFileSync(historyFile, 'utf-8')) || [];
      } catch {}
    }

    // --- Single question context printing ---
    if (question && question.trim().toLowerCase() === 'context') {
      this.printHistory(history, sessionName);
      return;
    }

    // --- Interactive loop ---
    if (!question || question.trim().length === 0) {
      const llmCfg = { ...(cfg.llm || {}) };
      if (options.provider) llmCfg.provider = options.provider;
      if (options.model) llmCfg.model = options.model;

      let client = Client.fromConfig(llmCfg, projectPath);

      const completer = (line: string) => {
        const commands = ['/exit', '/quit', '/clear', '/context', '/history', '/model', '/provider', '/session', '/settings', '/undo', '/help'];
        const hits = commands.filter((c) => c.startsWith(line));
        return [hits.length ? hits : commands, line];
      };

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer,
      });

      console.log(`🤖 Pure chat session started (no tools/context). Session: ${picocolors.yellow(sessionName)}`);
      console.log('Type /exit or /quit to end, /clear to clear memory, /context to view history. Type /help for all commands.\n');

      rl.setPrompt('ask> ');
      rl.prompt();

      let multilineMode = false;
      let buffer: string[] = [];

      rl.on('line', async (line) => {
        rl.pause();
        const input = line.trim();

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
            await processInput(fullInput);
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
            await processInput(input);
          }
        }

        rl.resume();
        rl.setPrompt('ask> ');
        rl.prompt();
      });

      const processInput = async (inputStr: string) => {
        if (inputStr.length === 0) return;

        if (inputStr.startsWith('/') || ['exit', 'quit', 'q', 'clear', 'context', 'help', 'settings', 'undo'].includes(inputStr.toLowerCase())) {
          const parts = inputStr.split(/\s+/);
          const cmd = parts[0].toLowerCase();
          const args = parts.slice(1).join(' ');

          if (['exit', 'quit', 'q', '/exit', '/quit', '/q'].includes(cmd)) {
            console.log('Bye!');
            rl.close();
            process.exit(0);
          }

          if (['clear', '/clear', '/c'].includes(cmd)) {
            try {
              if (fs.existsSync(historyFile)) fs.unlinkSync(historyFile);
              history = [];
              console.log(picocolors.yellow(`Memory cleared for session '${sessionName}'.`));
            } catch {}
            return;
          }

          if (['context', '/context', '/history'].includes(cmd)) {
            this.printHistory(history, sessionName);
            return;
          }

          if (['undo', '/undo'].includes(cmd)) {
            if (history.length >= 2) {
              history.splice(-2, 2);
              try {
                fs.mkdirSync(sessionsDir, { recursive: true });
                fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf-8');
                console.log('✅ Undid last turn.');
              } catch {}
            } else {
              console.log(picocolors.yellow('⚠️ Nothing to undo.'));
            }
            return;
          }

          if (['settings', '/settings'].includes(cmd)) {
            let maskedKey = picocolors.red('Missing');
            if (apiKey && apiKey.trim()) {
              maskedKey = apiKey.trim().length <= 8
                ? picocolors.green('Present (masked: ****)')
                : picocolors.green(`Present (masked: ${apiKey.trim().substring(0, 4)}...${apiKey.trim().substring(apiKey.trim().length - 4)})`);
            }
            console.log('Current Chat Settings:');
            console.log(`  Active Session:  ${picocolors.yellow(sessionName)} (stored in: ${historyFile})`);
            console.log(`  History size:    ${Math.floor(history.length / 2)} turns (${history.length} messages)`);
            console.log(`  LLM Provider:    ${picocolors.yellow(provider)}`);
            console.log(`  LLM Model:       ${picocolors.yellow(model || 'default')}`);
            console.log(`  API Key:         ${maskedKey}`);
            console.log(`  Config File:     ${cfgPath}`);
            return;
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
            console.log('  /undo            - Undo last turn (removes from memory)');
            console.log('  /help            - Show this help');
            return;
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
            return;
          }

          if (cmd === '/provider') {
            if (args.trim().length === 0) {
              console.log(`Current provider: ${provider}`);
              console.log('Usage: /provider <provider_name>');
            } else {
              provider = args.trim();
              llmCfg.provider = provider;
              apiKey = Env.resolveApiKey(provider);
              client = Client.fromConfig(llmCfg, projectPath);
              console.log(`Provider switched to: ${picocolors.yellow(provider)}`);
            }
            return;
          }

          if (['/session', '/s'].includes(cmd)) {
            if (args.trim().length === 0) {
              console.log(`Current session: ${picocolors.yellow(sessionName)}`);
              console.log('Usage: /session <session_name>');
            } else {
              try {
                const newSess = PathResolver.sanitizeSessionName(args.trim());
                sessionName = newSess;
                historyFile = path.join(sessionsDir, `${sessionName}.json`);
                history = [];
                if (fs.existsSync(historyFile)) {
                  try {
                    history = JSON.parse(fs.readFileSync(historyFile, 'utf-8')) || [];
                  } catch {}
                }
                console.log(`Switched to session: ${picocolors.yellow(sessionName)}`);
              } catch (e: any) {
                console.error(picocolors.red(`⛔️ Error: Invalid session name: ${e.message}`));
              }
            }
            return;
          }

          console.log(`Unknown command: ${cmd}`);
          return;
        }

        const messages: Message[] = [];
        const recentHistory = history.slice(-10);
        recentHistory.forEach((msg) => {
          messages.push({ role: msg.role, content: msg.content });
        });

        const systemInstruction = options.system || '';
        const qContent = systemInstruction
          ? `System Instruction: ${systemInstruction}\n\n${inputStr}`
          : inputStr;
        messages.push({ role: 'user', content: qContent });

        console.log(picocolors.blue(`🤖 Connecting to ${provider} (${model || 'default model'})...\n`));

        let responseText = '';
        try {
          await client.completeStream(messages, { temperature: temp, max_tokens: maxTokens }, (delta) => {
            process.stdout.write(delta);
            responseText += delta;
          });
          console.log('\n');

          if (responseText.trim().length > 0) {
            history.push({ role: 'user', content: inputStr });
            history.push({ role: 'assistant', content: responseText });
            history = history.slice(-100);

            try {
              fs.mkdirSync(sessionsDir, { recursive: true });
              fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf-8');
            } catch (e: any) {
              console.warn(picocolors.yellow(`⚠️ Warning: Failed to save session history: ${e.message}`));
            }
          }
        } catch (e: any) {
          console.error(picocolors.red(`\n⛔️ Error calling LLM: ${e.message}`));
        }
      };

      return;
    }

    // --- Single question mode ---
    const client = new Client({ provider, apiBase, apiKey, model });
    const messages: Message[] = [];
    const recentHistory = history.slice(-10);
    recentHistory.forEach((msg) => {
      messages.push({ role: msg.role, content: msg.content });
    });

    const systemInstruction = options.system || '';
    const qContent = systemInstruction
      ? `System Instruction: ${systemInstruction}\n\n${question}`
      : question;
    messages.push({ role: 'user', content: qContent });

    console.log(picocolors.blue(`🤖 Connecting to ${provider} (${model || 'default model'})...\n`));

    let responseText = '';
    try {
      await client.completeStream(messages, { temperature: temp, max_tokens: maxTokens }, (delta) => {
        process.stdout.write(delta);
        responseText += delta;
      });
      console.log();

      if (responseText.trim().length > 0) {
        history.push({ role: 'user', content: question });
        history.push({ role: 'assistant', content: responseText });
        history = history.slice(-100);

        try {
          fs.mkdirSync(sessionsDir, { recursive: true });
          fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf-8');
        } catch (e: any) {
          console.warn(picocolors.yellow(`⚠️ Warning: Failed to save session history: ${e.message}`));
        }
      }
    } catch (e: any) {
      console.error(picocolors.red(`\n⛔️ Error calling LLM: ${e.message}`));
    }
  }

  private static printHistory(history: Message[], sessionName: string): void {
    if (history.length === 0) {
      console.log(`No conversation history found for session '${sessionName}'.`);
      return;
    }

    console.log(`Conversation history for session '${sessionName}':`);
    console.log('='.repeat(50));
    history.forEach((msg, idx) => {
      const roleColor = msg.role === 'user' ? picocolors.green('User') : picocolors.blue('Assistant');
      console.log(`[${idx + 1}] ${roleColor}:`);
      console.log(msg.content);
      console.log('-'.repeat(50));
    });
  }
}

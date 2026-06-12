import path from 'node:path';
import readline from 'node:readline';
import picocolors from 'picocolors';
import type { ToolResult } from '../../core/kernel/interfaces.js';
import { RalphLoop } from '../../core/kernel/ralphLoop.js';
import { Runner } from '../../core/kernel/runner.js';
import * as Env from '../../core/llm/env.js';
import { SessionManager } from '../../core/memory/sessionManager.js';
import type { DaemonClient } from '../../daemon/client.js';
import { Dashboard } from '../commands/dashboard.js';
import * as UI from '../ui.js';
import { ConsoleRenderer } from './consoleRenderer.js';
import { Executor } from './executor.js';
import { SlashCommandManager } from './slashCommandManager.js';

export class Session {
  private projectPath: string;
  private options: Record<string, unknown>;
  private runner!: Runner;
  private config!: Record<string, unknown>;
  private sessionMgr!: SessionManager;
  private slashManager!: SlashCommandManager;
  private executor!: Executor;
  private auto = true;

  constructor(projectPath: string, options: Record<string, unknown> = {}) {
    this.projectPath = path.resolve(projectPath);
    this.options = options;
  }

  public async start(): Promise<void> {
    await this.setupEnvironment();
    const mode = (this.options.mode as string) || 'classic';
    const goal = this.options.goal as string;

    if (!this.options['no-daemon']) {
      const { DaemonClient } = await import('../../daemon/client.js');
      const client = new DaemonClient(this.projectPath);
      await client.connect();

      const currentSession = this.sessionMgr.currentName();
      await client.request('workspace/initialize', {
        sessionName: currentSession,
      });

      const renderer = new ConsoleRenderer({
        verbose: this.options.verbose as boolean,
      });

      client.onConfirmRequest(async (msg) => {
        return await renderer.askConfirmation(msg);
      });

      if (goal && goal.trim().length > 0) {
        client.onNotification((method, params) => {
          if (method === 'agent/onProgress') {
            const { type, payload } = params as {
              type: string;
              payload: Record<string, unknown>;
            };
            this.handleProgressNotification(renderer, type, payload);
          }
        });

        try {
          const res = await client.request('agent/runGoal', {
            goal,
            mode,
            options: {
              auto_mode: true,
              max_steps: this.options.max_steps,
              verify_command: this.options.verify,
              critic: this.options.critic,
              critic_mode: this.options.critic_mode,
            },
          });
          if (res.status === 'completed') {
            if (res.final_content) {
              console.log(res.final_content);
            }
          } else {
            throw new Error(
              `Daemon task loop finished with status: ${res.status}`,
            );
          }
        } finally {
          client.disconnect();
        }
        return;
      }

      // Interactive loop runs via Daemon!
      try {
        if (!goal || goal.trim().length === 0) {
          new Dashboard(this.projectPath, this.config, 'daemon').render();
        }
        await this.runLoopWithDaemon(client, renderer);
      } finally {
        client.disconnect();
      }
      return;
    }

    if (mode.toLowerCase() === 'ralph') {
      if (!goal || goal.trim().length === 0) {
        throw new UI.SessionError(
          'Ralph Loop requires an autonomous goal (use --goal or -g).',
        );
      }

      console.log(
        picocolors.blue(`🚀 Starting Ralph Loop for goal: '${goal}'`),
      );
      const bus = {
        emit: (event: string, payload: Record<string, unknown>) => {
          if (event === 'ralph_start') {
            console.log(picocolors.blue(`🚀 Starting Ralph Loop`));
            console.log(`   - Max Steps: ${payload.max_steps}`);
            console.log(`   - Verifier: ${payload.verifier}`);
            console.log('');
          } else if (event === 'ralph_step_start') {
            console.log(
              picocolors.cyan(
                `--- [Ralph Loop Step ${payload.step}/${payload.max_steps} | Session: ${payload.session}] ---`,
              ),
            );
          } else if (event === 'thought') {
            console.log(picocolors.gray(`💬 ${payload.content}`));
          } else if (event === 'warning') {
            console.warn(picocolors.yellow(`⚠️  ${payload.message}`));
          } else if (event === 'final_answer') {
            console.log(
              picocolors.green(
                `✅ Ralph Loop Success! All verification checks passed.`,
              ),
            );
            console.log(`Final Output: ${payload.content}`);
          } else if (event === 'loop_aborted') {
            console.error(
              picocolors.red(`Ralph Loop aborted: ${payload.reason}`),
            );
          }
        },
      };

      const ralph = new RalphLoop(this.runner, goal, {
        max_steps: this.options.max_steps,
        verify_command: this.options.verify,
        critic: this.options.critic,
        critic_mode: this.options.critic_mode,
        eventBus: bus,
      });

      const res = await ralph.run();
      if (res !== 'completed') {
        throw new UI.SessionError('Ralph Loop failed verification checks.');
      }
    } else {
      if (!goal || goal.trim().length === 0) {
        new Dashboard(this.projectPath, this.config, 'local').render();
      }
      await this.runLoop();
    }
  }

  private async setupEnvironment(): Promise<void> {
    this.runner = new Runner(this.projectPath);
    this.config = this.runner.loadConfig() || {};

    Env.loadFrom(this.projectPath);

    this.sessionMgr = new SessionManager(this.projectPath);
    const currentSession = this.sessionMgr.currentName();
    if (currentSession && this.options.verbose) {
      console.log(picocolors.yellow(`📝 Session: ${currentSession}`));
    }

    if (this.options.verbose) {
      this.config.verbose = true;
    }

    // LLM auto-configure defaults matching setup_environment in session.rb
    const llmConfig = (this.config.llm as Record<string, unknown>) || {};
    let provider = llmConfig.provider as string;
    if (!provider || provider.trim() === '' || provider === 'local') {
      if (process.env.OPENROUTER_API_KEY) {
        provider = 'openrouter';
        console.log(
          picocolors.green(
            'ℹ️ Auto-configured LLM provider: openrouter (from OPENROUTER_API_KEY)',
          ),
        );
      } else if (process.env.OPENAI_API_KEY) {
        provider = 'openai';
        console.log(
          picocolors.green(
            'ℹ️ Auto-configured LLM provider: openai (from OPENAI_API_KEY)',
          ),
        );
      } else if (process.env.ANTHROPIC_API_KEY) {
        provider = 'anthropic';
        console.log(
          picocolors.green(
            'ℹ️ Auto-configured LLM provider: anthropic (from ANTHROPIC_API_KEY)',
          ),
        );
      } else {
        provider = 'local';
      }
    }

    let model = llmConfig.model as string;
    if (!model || model.trim() === '') {
      if (provider === 'openrouter') {
        model = 'openai/gpt-4o-mini';
      } else if (provider === 'openai') {
        model = 'gpt-4o-mini';
      } else if (provider === 'anthropic') {
        model = 'claude-3-5-haiku-latest';
      } else if (provider === 'gemini') {
        model = 'gemini-2.5-flash';
      } else if (provider === 'deepseek') {
        model = 'deepseek-chat';
      }
      if (model && this.options.verbose) {
        console.log(picocolors.green(`ℹ️ Using default model: ${model}`));
      }
    }

    llmConfig.provider = provider;
    if (model) llmConfig.model = model;
    this.config.llm = llmConfig;

    this.slashManager = new SlashCommandManager(
      this.projectPath,
      () => this.runner.loadConfig(),
      this.runner,
      {
        onReload: () => {
          this.setupEnvironment();
        },
      },
    );
    this.executor = new Executor(this.projectPath, this.runner, () =>
      this.runner.loadConfig(),
    );
  }

  private async runLoop(): Promise<void> {
    const goal = this.options.goal as string;
    if (goal && goal.trim().length > 0) {
      const summary = await this.executor.processGoal(goal.trim());
      if (summary && summary.trim().length > 0) {
        console.log(summary);
      }
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      historySize: 1000,
    });

    let isClosed = false;
    rl.on('close', () => {
      isClosed = true;
    });

    rl.on('SIGINT', () => {
      if (rl.line.length > 0) {
        process.stdout.write('\n');
        rl.prompt();
      } else {
        rl.close();
      }
    });

    const promptStr = `${picocolors.cyan(picocolors.bold('aura'))} ${picocolors.gray('›')} `;

    const askQuestion = (): Promise<string | null> => {
      return new Promise((resolve) => {
        const onClose = () => resolve(null);
        rl.once('close', onClose);
        rl.question(promptStr, (answer) => {
          rl.off('close', onClose);
          resolve(answer);
        });
      });
    };

    try {
      while (!isClosed) {
        const inputVal = await askQuestion();
        if (inputVal === null) {
          console.log('\nBye!');
          break;
        }

        const input = inputVal.trim();
        if (!input) {
          continue;
        }

        if (
          ['exit', 'quit', '/exit', '/quit', '/q'].includes(input.toLowerCase())
        ) {
          console.log('Bye!');
          break;
        }

        if (
          ['auto on', '/auto on'].includes(
            input.toLowerCase().replace(/\s+/g, ' '),
          )
        ) {
          this.auto = true;
          console.log('Auto mode: ON');
          continue;
        }
        if (
          ['auto off', '/auto off'].includes(
            input.toLowerCase().replace(/\s+/g, ' '),
          )
        ) {
          this.auto = false;
          console.log('Auto mode: OFF (Interactive Mode)');
          continue;
        }
        if (['auto', '/auto'].includes(input.toLowerCase())) {
          console.log(
            'Usage: /auto on/off (Toggle auto-pilot/interactive mode)',
          );
          continue;
        }

        if (await this.slashManager.handle(input)) {
          continue;
        }

        try {
          await this.executor.process(input, this.auto);
        } catch (e: unknown) {
          console.error(
            picocolors.red(
              `⛔️ Error processing command: ${(e as Error).message}`,
            ),
          );
        }
      }
    } finally {
      if (!isClosed) {
        rl.close();
      }
    }
  }

  private async runLoopWithDaemon(
    client: DaemonClient,
    renderer: ConsoleRenderer,
  ): Promise<void> {
    const removeListener = client.onNotification(
      (method: string, params: Record<string, unknown>) => {
        if (method === 'agent/onProgress') {
          const { type, payload } = params as {
            type: string;
            payload: Record<string, unknown>;
          };
          this.handleProgressNotification(renderer, type, payload);
        }
      },
    );

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      historySize: 1000,
    });

    let isClosed = false;
    rl.on('close', () => {
      isClosed = true;
    });

    rl.on('SIGINT', () => {
      if (rl.line.length > 0) {
        process.stdout.write('\n');
        rl.prompt();
      } else {
        rl.close();
      }
    });

    const promptStr = `${picocolors.cyan(picocolors.bold('aura'))} ${picocolors.gray('›')} `;

    const askQuestion = (): Promise<string | null> => {
      return new Promise((resolve) => {
        const onClose = () => resolve(null);
        rl.once('close', onClose);
        rl.question(promptStr, (answer) => {
          rl.off('close', onClose);
          resolve(answer);
        });
      });
    };

    try {
      while (!isClosed) {
        const inputVal = await askQuestion();
        if (inputVal === null) {
          break;
        }

        const input = inputVal.trim();
        if (input.length === 0) {
          continue;
        }

        if (['exit', 'quit', '/exit', '/quit'].includes(input.toLowerCase())) {
          break;
        }

        if (
          ['auto on', '/auto on'].includes(
            input.toLowerCase().replace(/\s+/g, ' '),
          )
        ) {
          this.auto = true;
          console.log('Auto mode: ON');
          continue;
        }
        if (
          ['auto off', '/auto off'].includes(
            input.toLowerCase().replace(/\s+/g, ' '),
          )
        ) {
          this.auto = false;
          console.log('Auto mode: OFF (Interactive Mode)');
          continue;
        }
        if (['auto', '/auto'].includes(input.toLowerCase())) {
          console.log(
            'Usage: /auto on/off (Toggle auto-pilot/interactive mode)',
          );
          continue;
        }

        if (await this.slashManager.handle(input)) {
          continue;
        }

        try {
          const res = await client.request('agent/runGoal', {
            goal: input,
            mode: 'classic',
            options: {
              auto_mode: this.auto,
              max_steps: this.options.max_steps,
              verify_command: this.options.verify,
              critic: this.options.critic,
              critic_mode: this.options.critic_mode,
            },
          });
          if (res.status !== 'completed' && res.status !== 'failed') {
            throw new Error(
              `Daemon task loop finished with status: ${res.status}`,
            );
          }
        } catch (e: unknown) {
          console.error(
            picocolors.red(
              `⛔️ Error processing command: ${(e as Error).message}`,
            ),
          );
        }
      }
    } finally {
      removeListener();
      if (!isClosed) {
        rl.close();
      }
    }
  }

  private handleProgressNotification(
    renderer: ConsoleRenderer,
    type: string,
    payload: Record<string, unknown>,
  ): void {
    if (type === 'thought') {
      renderer.onThought(payload.content as string);
    } else if (type === 'token') {
      renderer.onToken(payload.text as string);
    } else if (type === 'stream_end') {
      renderer.onStreamEnd();
    } else if (type === 'waiting') {
      renderer.onWaiting(payload.elapsed as number);
    } else if (type === 'clear_waiting') {
      renderer.onClearWaiting();
    } else if (type === 'warning') {
      renderer.onWarning(payload.message as string);
    } else if (type === 'final_answer') {
      console.log(
        picocolors.green(
          `✅ Ralph Loop Success! All verification checks passed.`,
        ),
      );
      console.log(`Final Output: ${payload.content}`);
    } else if (type === 'tool_start') {
      renderer.onToolStart(
        payload.tool as string,
        payload.summary as string,
        payload.args as Record<string, unknown>,
      );
    } else if (type === 'tool_executing') {
      renderer.onToolExecuting();
    } else if (type === 'tool_result') {
      renderer.onToolResult(payload.result as ToolResult);
    } else if (type === 'loop_aborted') {
      renderer.onError(`Ralph Loop aborted: ${payload.reason}`);
    } else if (type === 'error') {
      renderer.onError(payload.message as string);
    } else if (type === 'ralph_start') {
      console.log(
        picocolors.blue(`🚀 Starting Ralph Loop for goal: '${payload.goal}'`),
      );
      console.log(`   - Max Steps: ${payload.max_steps}`);
      console.log(`   - Verifier: ${payload.verifier}`);
      console.log('');
    } else if (type === 'ralph_step_start') {
      console.log(
        picocolors.cyan(
          `--- [Ralph Loop Step ${payload.step}/${payload.max_steps} | Session: ${payload.session}] ---`,
        ),
      );
    }
  }
}

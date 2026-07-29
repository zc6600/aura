import path from 'node:path';
import readline from 'node:readline';
import picocolors from 'picocolors';
import {
  checkpointPath,
  loadCheckpoint,
} from '../../core/kernel/checkpoint.js';
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

      this.announceSuspendedRun(currentSession);

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
          // final_content has already been printed live via the
          // onToken/onStreamEnd progress notifications above — don't
          // print it again here.
          if (res.status !== 'completed') {
            // The specific failure reason was already reported via the
            // on_error progress notification (rendered above as it
            // streamed in). We still need to throw to get a non-zero exit
            // code (main() calls process.exit(0) unconditionally after a
            // successful run), but as a short CliError rather than a
            // generic Error — so it's reported as an expected failure
            // instead of "An unexpected error occurred", and without
            // restating the reason that was already printed above.
            throw new UI.CliError('Agent run did not complete successfully.');
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

      const previousAutoMode = this.runner.autoMode;
      this.runner.toggleAuto(true);
      let res: Awaited<ReturnType<RalphLoop['run']>>;
      try {
        res = await ralph.run();
      } finally {
        this.runner.toggleAuto(previousAutoMode);
      }
      if (res.status !== 'completed') {
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

    // LLM auto-configure defaults: silently pick whichever provider has a
    // key available when config.yml doesn't name one. Kept in sync with the
    // same detection Client.fromConfig() uses for the actual call, so the
    // dashboard/status display shown here doesn't drift from reality.
    const llmConfig = (this.config.llm as Record<string, unknown>) || {};
    let provider = llmConfig.provider as string;
    if (!provider || provider.trim() === '' || provider === 'local') {
      provider = Env.autoDetectProvider() || 'local';
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
      try {
        // The final answer is already printed live via the executor's
        // renderer (onToken/onStreamEnd) as it streams in — no need to
        // print the returned summary again here.
        await this.executor.processGoal(goal.trim(), {
          max_steps: this.options.max_steps as number | undefined,
        });
      } catch (_e: unknown) {
        // The specific failure reason was already reported via the
        // on_warning/on_error progress notifications rendered above as the
        // loop ran — throw a short CliError instead of letting the raw
        // Error bubble up as a second, less specific "unexpected error".
        throw new UI.CliError('Agent run did not complete successfully.');
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
          await this.executor.process(input, this.auto, {
            max_steps: this.options.max_steps as number | undefined,
          });
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

    // While a goal is in flight the readline has no pending question, so
    // Ctrl+C is the user's only channel. Use it to park the run rather than
    // kill it — the daemon accepts agent/pause on the same socket that the
    // pending agent/runGoal is already using.
    let goalRunning = false;
    let pauseRequested = false;
    rl.on('SIGINT', () => {
      if (goalRunning) {
        if (pauseRequested) {
          console.log(
            picocolors.yellow('\n⏹  Forcing shutdown (run will not be saved).'),
          );
          rl.close();
          return;
        }
        pauseRequested = true;
        console.log(
          picocolors.yellow(
            '\n⏸  Suspending after the current step finishes… (Ctrl+C again to force quit)',
          ),
        );
        client.request('agent/pause').catch((e: unknown) => {
          console.error(
            picocolors.red(`Could not suspend: ${(e as Error).message}`),
          );
        });
        return;
      }
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

        // Handled here rather than in SlashCommandManager because resuming is
        // a daemon round-trip, and the manager has no client to talk to.
        const isResume = ['resume', '/resume'].includes(input.toLowerCase());

        if (!isResume && (await this.slashManager.handle(input))) {
          continue;
        }

        try {
          goalRunning = true;
          pauseRequested = false;
          const res = await client.request('agent/runGoal', {
            ...(isResume ? { resume: true } : { goal: input }),
            mode: 'classic',
            options: {
              auto_mode: this.auto,
              max_steps: this.options.max_steps,
              verify_command: this.options.verify,
              critic: this.options.critic,
              critic_mode: this.options.critic_mode,
            },
          });
          if (res.status === 'suspended') {
            console.log(
              picocolors.yellow(
                `⏸  Suspended after ${res.stepCount} step(s). Type ${picocolors.bold('/resume')} to continue.`,
              ),
            );
          } else if (res.status !== 'completed' && res.status !== 'failed') {
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
        } finally {
          goalRunning = false;
        }
      }
    } finally {
      removeListener();
      if (!isClosed) {
        rl.close();
      }
    }
  }

  /**
   * Tells the user up front that this session has a parked run, including what
   * it was working on — a checkpoint survives daemon restarts, so it may well
   * be from a previous day.
   */
  private announceSuspendedRun(sessionName: string | null): void {
    try {
      const saved = loadCheckpoint(
        checkpointPath(this.projectPath, sessionName || 'default'),
      );
      if (saved?.reason !== 'user_paused') {
        return;
      }
      const goalPreview =
        saved.goal.length > 70 ? `${saved.goal.slice(0, 70)}…` : saved.goal;
      console.log(
        picocolors.yellow(
          `⏸  Suspended run in this session (${saved.stepCount} step(s), ${saved.createdAt}): ${goalPreview}`,
        ),
      );
      console.log(
        picocolors.gray(`   Type ${picocolors.bold('/resume')} to continue.`),
      );
    } catch {
      // A missing or unreadable checkpoint is not worth interrupting startup.
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

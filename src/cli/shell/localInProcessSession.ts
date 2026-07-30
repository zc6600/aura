import path from 'node:path';
import readline from 'node:readline';
import picocolors from 'picocolors';
import { RalphLoop } from '../../core/kernel/ralphLoop.js';
import { Runner } from '../../core/kernel/runner.js';
import { LLMClient } from '../../core/llm/client.js';
import * as Env from '../../core/llm/env.js';
import type { LLMConfig } from '../../core/llm/types.js';
import { SessionManager } from '../../core/memory/sessionManager.js';
import { Dashboard } from '../commands/dashboard.js';
import * as UI from '../ui.js';
import { Executor } from './executor.js';
import { SlashCommandManager } from './slashCommandManager.js';

export class LocalInProcessSession {
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
    if (this.executor) {
      this.executor.destroy();
    }
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

    const llmConfig = (this.config.llm as Record<string, unknown>) || {};
    const client = LLMClient.fromConfig(
      llmConfig as LLMConfig,
      this.projectPath,
    );
    const previousModel = llmConfig.model as string | undefined;

    llmConfig.provider = client.provider;
    llmConfig.model = client.model;
    this.config.llm = llmConfig;

    if (!previousModel && client.model && this.options.verbose) {
      console.log(
        picocolors.green(`ℹ️ Using default model: ${client.model}`),
      );
    }

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
        await this.executor.processGoal(goal.trim(), {
          max_steps: this.options.max_steps as number | undefined,
        });
      } catch (_e: unknown) {
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
      if (this.executor) {
        this.executor.destroy();
      }
    }
  }
}

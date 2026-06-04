import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import picocolors from 'picocolors';
import { Runner } from '../../core/kernel/runner.js';
import { RalphLoop } from '../../core/kernel/ralphLoop.js';
import { SessionManager } from '../../core/memory/sessionManager.js';
import { SlashCommandManager } from './slashCommandManager.js';
import { Executor } from './executor.js';
import { Dashboard } from '../commands/dashboard.js';
import * as PathResolver from '../../utils/pathResolver.js';
import * as Env from '../../core/llm/env.js';

export class Session {
  private projectPath: string;
  private options: any;
  private runner!: Runner;
  private config!: any;
  private sessionMgr!: SessionManager;
  private slashManager!: SlashCommandManager;
  private executor!: Executor;
  private auto = true;

  constructor(projectPath: string, options: any = {}) {
    this.projectPath = path.resolve(projectPath);
    this.options = options;
  }

  public async start(): Promise<void> {
    await this.setupEnvironment();
    const mode = this.options.mode || 'classic';
    const goal = this.options.goal;

    if (mode.toLowerCase() === 'ralph') {
      if (!goal || goal.trim().length === 0) {
        console.error(picocolors.red('⛔️ Error: Ralph Loop requires an autonomous goal (use --goal or -g).'));
        process.exit(1);
      }

      console.log(picocolors.blue(`🚀 Starting Ralph Loop for goal: '${goal}'`));
      const bus = {
        emit: (event: string, payload: any) => {
          if (event === 'ralph_start') {
            console.log(picocolors.blue(`🚀 Starting Ralph Loop`));
            console.log(`   - Max Steps: ${payload.max_steps}`);
            console.log(`   - Verifier: ${payload.verifier}`);
            console.log('');
          } else if (event === 'ralph_step_start') {
            console.log(picocolors.cyan(`--- [Ralph Loop Step ${payload.step}/${payload.max_steps} | Session: ${payload.session}] ---`));
          } else if (event === 'thought') {
            console.log(picocolors.gray(`💬 ${payload.content}`));
          } else if (event === 'warning') {
            console.warn(picocolors.yellow(`⚠️  ${payload.message}`));
          } else if (event === 'final_answer') {
            console.log(picocolors.green(`✅ Ralph Loop Success! All verification checks passed.`));
            console.log(`Final Output: ${payload.content}`);
          } else if (event === 'loop_aborted') {
            console.error(picocolors.red(`Ralph Loop aborted: ${payload.reason}`));
          }
        }
      };

      const ralph = new RalphLoop(this.runner, goal, {
        max_steps: this.options.max_steps,
        verify_command: this.options.verify,
        critic: this.options.critic,
        critic_mode: this.options.critic_mode,
        eventBus: bus,
      });

      const res = await ralph.run();
      if (res === 'completed') {
        process.exit(0);
      } else {
        process.exit(1);
      }
    } else {
      if (!goal || goal.trim().length === 0) {
        new Dashboard(this.projectPath, this.config).render();
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
    const llmConfig = this.config.llm || {};
    let provider = llmConfig.provider;
    if (!provider || provider.trim() === '' || provider === 'local') {
      if (process.env.OPENROUTER_API_KEY) {
        provider = 'openrouter';
        console.log(picocolors.green('ℹ️ Auto-configured LLM provider: openrouter (from OPENROUTER_API_KEY)'));
      } else if (process.env.OPENAI_API_KEY) {
        provider = 'openai';
        console.log(picocolors.green('ℹ️ Auto-configured LLM provider: openai (from OPENAI_API_KEY)'));
      } else if (process.env.ANTHROPIC_API_KEY) {
        provider = 'anthropic';
        console.log(picocolors.green('ℹ️ Auto-configured LLM provider: anthropic (from ANTHROPIC_API_KEY)'));
      } else {
        provider = 'local';
      }
    }

    let model = llmConfig.model;
    if (!model || model.trim() === '') {
      if (provider === 'openrouter') {
        model = 'openai/gpt-4o';
      } else if (provider === 'openai') {
        model = 'gpt-4o';
      } else if (provider === 'anthropic') {
        model = 'claude-3-5-sonnet-latest';
      }
      if (model && this.options.verbose) {
        console.log(picocolors.green(`ℹ️ Using default model: ${model}`));
      }
    }

    llmConfig.provider = provider;
    if (model) llmConfig.model = model;
    this.config.llm = llmConfig;

    this.slashManager = new SlashCommandManager(this.projectPath, () => this.runner.loadConfig(), this.runner, {
      onReload: () => { this.setupEnvironment(); }
    });
    this.executor = new Executor(this.projectPath, this.runner, () => this.runner.loadConfig());
  }

  private async runLoop(): Promise<void> {
    const goal = this.options.goal || this.options.g;
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
    });

    console.log('Welcome to Aura Shell. Type /help for commands, /exit to exit.');
    rl.setPrompt('aura> ');
    rl.prompt();

    let multilineMode = false;
    let buffer: string[] = [];

    rl.on('line', async (line) => {
      rl.pause();

      let input = line.trim();
      if (multilineMode) {
        if (input.endsWith('\\')) {
          buffer.push(input.substring(0, input.length - 1));
          rl.resume();
          rl.setPrompt('....> ');
          rl.prompt();
          return;
        } else {
          buffer.push(input);
          input = buffer.join('\n');
          buffer = [];
          multilineMode = false;
        }
      } else {
        if (input.endsWith('\\')) {
          buffer.push(input.substring(0, input.length - 1));
          multilineMode = true;
          rl.resume();
          rl.setPrompt('....> ');
          rl.prompt();
          return;
        }
      }

      if (['exit', 'quit', '/exit', '/quit', '/q'].includes(input.toLowerCase())) {
        console.log('Bye!');
        rl.close();
        process.exit(0);
      }

      if (await this.slashManager.handle(input)) {
        rl.resume();
        rl.setPrompt('aura> ');
        rl.prompt();
        return;
      }

      if (['auto on', '/auto on'].includes(input.toLowerCase().replace(/\s+/g, ' '))) {
        this.auto = true;
        console.log('Auto mode: ON');
        rl.resume();
        rl.setPrompt('aura> ');
        rl.prompt();
        return;
      }
      if (['auto off', '/auto off'].includes(input.toLowerCase().replace(/\s+/g, ' '))) {
        this.auto = false;
        console.log('Auto mode: OFF (Interactive Mode)');
        rl.resume();
        rl.setPrompt('aura> ');
        rl.prompt();
        return;
      }

      if (input.length > 0) {
        try {
          await this.executor.process(input, this.auto);
        } catch (e: any) {
          console.error(picocolors.red(`⛔️ Error processing command: ${e.message}`));
        }
      }

      rl.resume();
      rl.setPrompt('aura> ');
      rl.prompt();
    });
  }
}

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import * as PathResolver from '../../utils/pathResolver.js';
import { ContextAssembler } from '../context/assembler.js';
import { ContextPayload } from '../context/payload.js';
import type { LLMMessage } from '../llm/adapters/base.js';
import { ResponseParser } from '../llm/parsers/responseParser.js';
import type { ChatMessage, ToolSchema } from '../llm/types.js';
import { AgentLoop, type AgentLoopResult } from './agentLoop.js';
import type { HookFn, IEventBus, IRalphRunner } from './interfaces.js';

interface CriticResponse {
  completed?: boolean;
  critique?: string;
  advice?: string;
}

export class RalphPayload {
  constructor(
    public readonly messages: ChatMessage[],
    public readonly tools: ToolSchema[] = [],
  ) {}

  public toMessages(): ChatMessage[] {
    return this.messages;
  }

  public toToolSchemas(): ToolSchema[] {
    return this.tools;
  }

  public toMarkdown(): string {
    return this.toString();
  }

  public toString(): string {
    return this.messages
      .map((m) => `## ${m.role.toUpperCase()}\n${m.content}`)
      .join('\n\n');
  }
}

export class RalphLoop {
  public static readonly DEFAULT_MAX_STEPS = 100;
  public static readonly DEFAULT_TIMEOUT = 45; // seconds
  public static readonly MAX_UNTRACKED_FILES = 15;
  public static readonly MAX_FILE_SIZE_BYTES = 20480; // 20KB

  private runner: IRalphRunner;
  private projectPath: string;
  private envPath: string;
  private goal: string;
  private options: Record<string, unknown>;
  private eventBus: IEventBus;

  private maxSteps: number;
  private verifyCommand?: string | null;
  private criticMode: string;
  private useCritic: boolean;

  private lastToolName = 'None';
  private lastToolOutput = 'No tools executed yet.';
  private lastTestFeedback = 'Not run yet.';
  private currentMode: 'developer' | 'critic' = 'developer';
  private planningHookProc!: HookFn;

  private runId = '';
  private iterationCount = 1;
  private tempSessions: string[] = [];

  constructor(
    runner: IRalphRunner,
    goal: string,
    options: Record<string, unknown> = {},
  ) {
    this.runner = runner;
    this.projectPath = path.resolve(this.runner.projectPath);
    this.envPath = path.resolve(this.runner.envPath);
    this.goal = goal;
    this.options = options || {};
    const eb = options.eventBus as IEventBus | undefined;
    this.eventBus = eb ?? { emit: () => {} };

    const cfg = this.runner.loadConfig();
    const ralphCfg = (cfg.ralph ?? {}) as Record<string, unknown>;
    this.maxSteps = Number(
      this.options.max_steps ??
        ralphCfg.max_steps ??
        RalphLoop.DEFAULT_MAX_STEPS,
    );
    this.verifyCommand = (this.options.verify_command ??
      ralphCfg.verify_command) as string | undefined;
    this.criticMode = String(
      this.options.critic_mode ?? ralphCfg.critic_mode ?? 'light',
    ).toLowerCase();
    this.useCritic = Boolean(
      this.options.critic ?? ralphCfg.use_critic ?? this.criticMode === 'heavy',
    );

    this.resetStateVariables();
    this.setupPlanningHook();
  }

  public async run(): Promise<'completed' | 'failed'> {
    this.runner.hooks.register('before_planning', this.planningHookProc);
    this.runId = `${new Date().toISOString().replace(/[-:T.Z]/g, '')}_${crypto.randomBytes(4).toString('hex')}`;
    this.iterationCount = 1;
    const startingSession = process.env.AURA_SESSION_NAME || 'default';
    this.tempSessions = [];

    // Automatically seed a checklist task.md if none exists
    const taskPath = path.join(this.projectPath, 'task.md');
    if (!fs.existsSync(taskPath)) {
      try {
        fs.writeFileSync(
          taskPath,
          `# Task Progress Checklist\n- [ ] ${this.goal}\n`,
          'utf-8',
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.eventBus.emit('warning', {
          message: `Failed to create task.md checklist: ${msg}`,
        });
      }
    }

    this.resetStateVariables();

    this.eventBus.emit('ralph_start', {
      goal: this.goal,
      max_steps: this.maxSteps,
      verifier: this.useCritic
        ? 'Critic LLM'
        : `Physical command: '${this.verifyCommand}'`,
    });

    const signal = this.options.signal as AbortSignal | undefined;
    if (signal?.aborted) {
      return 'failed';
    }

    try {
      while (true) {
        if (signal?.aborted) {
          this.eventBus.emit('loop_aborted', {
            reason: 'Session aborted (client disconnected)',
          });
          return 'failed';
        }

        if (this.iterationCount > this.maxSteps) {
          this.eventBus.emit('loop_aborted', {
            reason: `Max steps limit reached (${this.maxSteps})`,
          });
          return 'failed';
        }

        this.currentMode = 'developer';

        const sessionName = `ralph_run_${this.runId}_step_${this.iterationCount}`;
        this.tempSessions.push(sessionName);

        this.eventBus.emit('ralph_step_start', {
          step: this.iterationCount,
          max_steps: this.maxSteps,
          session: sessionName,
        });

        // 1. Swaps the runner session dynamically
        this.runner.reconnectSession(sessionName);

        // 2. Execute standard developer AgentLoop
        this.eventBus.emit('thought', {
          content: `Starting Developer AgentLoop (Iteration ${this.iterationCount}/${this.maxSteps})...`,
        });

        // Inner event bus mapping
        const innerBus: IEventBus = {
          emit: (ev: string, data?: unknown) => {
            if (ev !== 'final_answer' && ev !== 'loop_aborted') {
              this.eventBus.emit(ev, data);
            }
          },
        };

        const agentLoop = new AgentLoop(this.runner, { eventBus: innerBus });

        let result: AgentLoopResult;
        try {
          result = await agentLoop.run(this.goal, { ctx: null });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          this.eventBus.emit('thought', {
            content: `Developer AgentLoop raised an exception: ${msg}`,
          });
          result = { status: 'failed', steps: [], failure_reason: msg };
        }

        if (result.steps && result.steps.length > 0) {
          const lastStep = result.steps[result.steps.length - 1];
          this.lastToolName = lastStep.tool || 'None';
          this.lastToolOutput = this.formatToolResult(lastStep.result);
        } else {
          this.lastToolName = 'None';
          this.lastToolOutput = 'No tools executed in this turn.';
        }

        this.eventBus.emit('thought', {
          content: `Developer AgentLoop finished with status: ${result.status}. Running verification checks...`,
        });

        // 3. Verification check
        const verification = await this.runVerification();

        if (result.status === 'completed' && verification.passed) {
          const finalContent =
            result.final_content || 'Task completed successfully.';
          this.eventBus.emit('final_answer', { content: finalContent });
          return 'completed';
        } else {
          const reason =
            result.status === 'completed'
              ? 'Verification check failed.'
              : `AgentLoop did not complete naturally (${result.status}: ${result.failure_reason || 'unknown'})`;
          this.eventBus.emit('thought', {
            content: `${reason} Final attempt rejected.`,
          });
          this.lastTestFeedback = verification.output;
          this.iterationCount++;
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.eventBus.emit('thought', {
        content: `Ralph Loop encountered a fatal error: ${msg}`,
      });
      return 'failed';
    } finally {
      // Restore session
      try {
        this.runner.reconnectSession(startingSession);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.eventBus.emit('warning', {
          message: `Error reconnecting starting session: ${msg}`,
        });
      }

      this.cleanTemporarySessionFiles();
      this.runner.hooks.unregister('before_planning', this.planningHookProc);
    }
  }

  private resetStateVariables(): void {
    this.lastToolName = 'None';
    this.lastToolOutput = 'No tools executed yet.';
    this.lastTestFeedback = 'Not run yet.';
    this.currentMode = 'developer';
  }

  private cleanTemporarySessionFiles(): void {
    for (const sessionName of this.tempSessions) {
      try {
        const dbPath = PathResolver.sessionDbPath(
          this.projectPath,
          sessionName,
        );
        if (fs.existsSync(dbPath)) {
          fs.unlinkSync(dbPath);
        }
        for (const suffix of ['-journal', '-wal', '-shm']) {
          const sidecar = `${dbPath}${suffix}`;
          if (fs.existsSync(sidecar)) {
            fs.unlinkSync(sidecar);
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.eventBus.emit('warning', {
          message: `Error deleting temporary session files for ${sessionName}: ${msg}`,
        });
      }
    }
  }

  private setupPlanningHook(): void {
    this.planningHookProc = async (...args: unknown[]) => {
      const payload = args[0] as { context: unknown };
      const ctx = payload.context;
      if (ctx instanceof RalphPayload) return;

      if (this.currentMode === 'critic') {
        const audit = await this.buildAuditContext();
        payload.context = this.assembleContext({
          directive_mode: 'ralph_critic',
          critic_mode: this.criticMode,
          ralph_audit: audit,
        });
      } else {
        payload.context = this.assembleContext({
          directive_mode: 'ralph_developer',
          ralph_recap: {
            last_tool: this.lastToolName,
            last_output: this.lastToolOutput,
            last_test: this.lastTestFeedback,
            verifier_mode: this.useCritic
              ? 'Critic LLM Audit'
              : 'Physical Command',
          },
        });
      }
      return true;
    };
  }

  /**
   * Safely assembles a ContextPayload. Falls back to a minimal payload when
   * the memory store's db is unavailable (e.g., in unit tests with mocks).
   */
  private assembleContext(options: Record<string, unknown>): ContextPayload {
    const db = this.runner.memory?.store?.db;
    if (db) {
      return ContextAssembler.assemble(this.projectPath, db, options);
    }
    // Fallback: build a minimal ContextPayload from sections only (no db needed)
    return new ContextPayload({}, [], options);
  }

  private async runVerification(): Promise<{
    passed: boolean;
    output: string;
  }> {
    if (this.useCritic) {
      return await this.runCriticAudit();
    } else {
      return await this.runPhysicalTest();
    }
  }

  private async runPhysicalTest(): Promise<{
    passed: boolean;
    output: string;
  }> {
    if (!this.verifyCommand?.trim()) {
      return {
        passed: true,
        output: 'No verification command configured. Auto-passed.',
      };
    }

    const cfg = this.runner.loadConfig();
    const ralphCfg = (cfg.ralph ?? {}) as Record<string, unknown>;
    const timeoutSec = Number(
      this.options.timeout ?? ralphCfg.timeout ?? RalphLoop.DEFAULT_TIMEOUT,
    );

    try {
      const execPromise = execa('sh', ['-c', this.verifyCommand], {
        cwd: this.projectPath,
        timeout: timeoutSec * 1000,
        reject: false,
      });

      const res = await execPromise;
      if ((res as { timedOut?: boolean }).timedOut) {
        return {
          passed: false,
          output: `Verification command timed out after ${timeoutSec} seconds.`,
        };
      }
      const passed = res.exitCode === 0;
      const output = `STDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`;
      return { passed, output };
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'timedOut' in e && (e as { timedOut?: boolean }).timedOut) {
        return {
          passed: false,
          output: `Verification command timed out after ${timeoutSec} seconds.`,
        };
      }
      return {
        passed: false,
        output: `Error running test command: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  private async runCriticAudit(): Promise<{ passed: boolean; output: string }> {
    this.currentMode = 'critic';

    try {
      const testRes = await this.runPhysicalTest();
      this.lastTestFeedback = testRes.output;

      const audit = await this.buildAuditContext();
      const criticPayload = this.assembleContext({
        directive_mode: 'ralph_critic',
        critic_mode: this.criticMode,
        ralph_audit: audit,
      });

      let content = '';
      if (this.criticMode === 'heavy') {
        const criticSession = `ralph_critic_audit_${this.runId}_step_${this.iterationCount}`;
        this.tempSessions.push(criticSession);
        this.runner.reconnectSession(criticSession);

        this.eventBus.emit('thought', {
          content: 'Starting Critic AgentLoop (heavy mode)...',
        });
        const criticLoop = new AgentLoop(this.runner, {
          eventBus: this.innerEventBus(),
        });

        try {
          const result = await criticLoop.run('Audit changes', {
            ctx: criticPayload.toMarkdown(),
          });
          content = result.final_content || '';
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          this.eventBus.emit('thought', {
            content: `Critic AgentLoop failed: ${errMsg}`,
          });
          return {
            passed: false,
            output: `Critic LLM loop error: ${errMsg}`,
          };
        }
      } else {
        this.eventBus.emit('thought', {
          content: 'Calling Critic LLM in light mode (single-turn)...',
        });
        const messages = criticPayload.toMessages({
          goal: 'Audit changes',
        }) as LLMMessage[];
        const options = {
          temperature: this.runner.planner.temp,
          max_tokens: this.runner.planner.maxTokens,
        };
        const res = await this.runner.planner.client.complete(
          messages,
          options,
        );
        content = res.content || res.raw || '';
      }

      const parsed = ResponseParser.safeJsonParse(content);
      if (parsed && typeof parsed === 'object') {
        const criticResponse = parsed as CriticResponse;
        const completed = criticResponse.completed === true;
        const critique = criticResponse.critique || '';
        const advice = criticResponse.advice || '';

        this.writeCriticAuditFile(critique, advice, completed);
        const feedback = `CRITIQUE:\n${critique}\n\nADVICE:\n${advice}`;
        return { passed: completed, output: feedback };
      } else {
        const feedback = `Critic LLM output format error. Feedback:\n${content}`;
        this.writeCriticAuditFile(
          `Failed to parse JSON critique. Raw: ${content}`,
          'Ensure critic outputs JSON.',
          false,
        );
        return { passed: false, output: feedback };
      }
    } finally {
      this.currentMode = 'developer';
    }
  }

  private async buildAuditContext(): Promise<Record<string, unknown>> {
    const diff = await this.getGitDiffWithUntracked();
    const prevCritique = this.loadPreviousCritique();
    const testOutput = this.formatTestOutput();
    const taskContent = this.readTaskMd();

    return {
      changes: diff,
      previous_audit: prevCritique,
      test_output: testOutput,
      task_content: taskContent,
    };
  }

  private formatTestOutput(): string {
    if (this.verifyCommand?.trim()) {
      return `### Test Execution Output (Command: '${this.verifyCommand}'):\n${this.lastTestFeedback}`;
    }
    return 'No physical verification command configured.';
  }

  private readTaskMd(): string {
    const taskPath = path.join(this.projectPath, 'task.md');
    if (!fs.existsSync(taskPath)) return '';
    try {
      return `### task.md Checklist:\n\`\`\`markdown\n${fs.readFileSync(taskPath, 'utf-8')}\n\`\`\``;
    } catch (_e) {
      return '### task.md Checklist:\n[Error reading task.md]';
    }
  }

  private async getGitDiff(): Promise<string> {
    try {
      const { stdout } = await execa('git', ['diff', 'HEAD'], {
        cwd: this.projectPath,
      });
      return stdout;
    } catch (_e) {
      return '';
    }
  }

  private async getGitDiffWithUntracked(): Promise<string> {
    const diff = await this.getGitDiff();
    const untrackedFiles: string[] = [];

    try {
      const { stdout } = await execa('git', ['status', '--porcelain'], {
        cwd: this.projectPath,
      });
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.startsWith('?? ')) {
          untrackedFiles.push(line.substring(3).trim());
        }
      }
    } catch (_e) {}

    const untrackedContent: string[] = [];
    const filesToRead = untrackedFiles.slice(0, RalphLoop.MAX_UNTRACKED_FILES);

    for (const f of filesToRead) {
      const fullPath = path.join(this.projectPath, f);
      try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          if (fs.statSync(fullPath).size <= RalphLoop.MAX_FILE_SIZE_BYTES) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            if (content.includes('\u0000')) {
              untrackedContent.push(
                `### Untracked File: ${f}\n[Skipped: Binary file detected]`,
              );
            } else {
              untrackedContent.push(
                `### Untracked File: ${f}\n\`\`\`\n${content}\n\`\`\``,
              );
            }
          }
        }
      } catch (e: unknown) {
        untrackedContent.push(
          `### Untracked File: ${f}\n[Error reading file: ${(e as Error).message}]`,
        );
      }
    }

    if (untrackedFiles.length > RalphLoop.MAX_UNTRACKED_FILES) {
      untrackedContent.push(
        `### [Truncated: ${untrackedFiles.length - RalphLoop.MAX_UNTRACKED_FILES} additional untracked files present but skipped]`,
      );
    }

    return [
      diff
        ? `### Tracked Git Diff:\n\`\`\`diff\n${diff}\n\`\`\``
        : 'No tracked changes in Git.',
      untrackedContent.length > 0
        ? `### Untracked Files Content:\n${untrackedContent.join('\n\n')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private loadPreviousCritique(): string {
    const prevStep = this.iterationCount - 1;
    const auditPath = path.join(
      this.envPath,
      'state',
      `critic_audit_${this.runId}_step_${prevStep}.md`,
    );
    if (fs.existsSync(auditPath)) {
      try {
        return fs.readFileSync(auditPath, 'utf-8');
      } catch (_e) {
        return 'No previous critic audit exists.';
      }
    }
    return 'No previous critic audit exists.';
  }

  private writeCriticAuditFile(
    critique: string,
    advice: string,
    passed: boolean,
  ): void {
    const auditPath = path.join(
      this.envPath,
      'state',
      `critic_audit_${this.runId}_step_${this.iterationCount}.md`,
    );
    const statusStr = passed ? 'PASSING' : 'FAILING';
    const content = [
      '# Critic Audit Report',
      `- **Status**: ${statusStr}`,
      `- **Timestamp**: ${new Date().toISOString()}`,
      '',
      '## Critique',
      critique,
      '',
      '## Advice',
      advice,
    ].join('\n');

    try {
      fs.mkdirSync(path.dirname(auditPath), { recursive: true });
      fs.writeFileSync(auditPath, content, 'utf-8');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.eventBus.emit('warning', {
        message: `Error writing critic audit file: ${msg}`,
      });
    }
  }

  public getRunId(): string {
    return this.runId;
  }

  public setRunId(runId: string): void {
    this.runId = runId;
  }

  public getIterationCount(): number {
    return this.iterationCount;
  }

  public setIterationCount(iterationCount: number): void {
    this.iterationCount = iterationCount;
  }

  public getPlanningHookProc(): HookFn {
    return this.planningHookProc;
  }

  public getCurrentMode(): string {
    return this.currentMode;
  }

  public getLastTestFeedback(): string {
    return this.lastTestFeedback;
  }

  private formatToolResult(runRes: unknown): string {
    if (!runRes || typeof runRes !== 'object') {
      return 'No result payload returned.';
    }
    const r = runRes as {
      status?: string;
      output?: string | null;
      content?: string | null;
    };
    const status = r.status ?? 'ok';
    const output = r.output ?? r.content ?? JSON.stringify(runRes);
    return `Status: ${status}\nOutput:\n${output}`;
  }

  private innerEventBus(): IEventBus {
    return {
      emit: (ev: string, data?: unknown) => {
        if (ev !== 'final_answer' && ev !== 'loop_aborted') {
          this.eventBus.emit(ev, data);
        }
      },
    };
  }
}

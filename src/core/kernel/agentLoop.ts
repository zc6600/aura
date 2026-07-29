import type { ParseResult } from '../llm/parsers/responseParser.js';
import type {
  CheckpointReason,
  LoopCheckpoint,
  LoopStep,
} from './checkpoint.js';
import { resumeBanner } from './checkpoint.js';
import type { IEventBus, IRunner, ToolCall, ToolResult } from './interfaces.js';

interface SystemConfig {
  max_steps?: number;
  max_format_errors?: number;
  max_tool_errors?: number;
  /** Max consecutive empty/blank tool results before aborting (default: 5). */
  max_empty_results?: number;
  /** Max consecutive calls to the same tool (by name+arg-keys fingerprint) before aborting (default: 4). */
  max_repeat_calls?: number;
}

/**
 * A pause request the loop polls at each iteration boundary.
 *
 * Deliberately a mutable flag rather than an AbortSignal: the loop needs to
 * *finish* the current step and return a checkpoint, which is the opposite of
 * abort's unwind-the-stack semantics. Keeping the two separate avoids the
 * string-matched abort handling below ever swallowing a pause.
 */
export interface PauseSignal {
  requested: boolean;
}

export interface AgentLoopResult {
  status: 'completed' | 'failed' | 'suspended';
  final_content?: string | null;
  steps: LoopStep[];
  failure_reason?: string | null;
  /** Present when failure_reason is 'sandbox_path_blocked'; the path a human needs to approve. */
  blocked_path?: { path: string; attempts: number; threshold: number } | null;
  /** Present on 'suspended', and on a 'sandbox_path_blocked' failure. Lets the run be resumed. */
  checkpoint?: LoopCheckpoint | null;
}

export class AgentLoop {
  private runner: IRunner;
  private eventBus: IEventBus;
  private steps: LoopStep[] = [];
  /** Sliding window of recent tool-call fingerprints for loop detection. */
  private recentCallFingerprints: string[] = [];

  constructor(runner: IRunner, options: { eventBus?: IEventBus } = {}) {
    this.runner = runner;
    this.eventBus = options.eventBus || { emit: () => {} };
  }

  /**
   * Steps completed so far. Readable after `run()` throws — an interrupt
   * unwinds the stack, and callers still need the real step history rather
   * than an empty list.
   */
  public get completedSteps(): LoopStep[] {
    return this.steps;
  }

  public async run(
    goal: string,
    options: {
      ctx?: string | null;
      max_steps?: number | null;
      /** Polled at each iteration boundary; set it to park the run. */
      pauseSignal?: PauseSignal | null;
      /** Restores a previously suspended run instead of starting fresh. */
      checkpoint?: LoopCheckpoint | null;
    } = {},
  ): Promise<AgentLoopResult> {
    const cfg =
      typeof this.runner.loadConfig === 'function'
        ? this.runner.loadConfig()
        : {};
    const systemConfig = (cfg.system || {}) as SystemConfig;
    const limitSteps = options.max_steps ?? systemConfig.max_steps ?? 30;
    const maxFmtErrs = systemConfig.max_format_errors ?? 5;
    const maxToolErrs = systemConfig.max_tool_errors ?? 3;
    const maxEmptyResults = systemConfig.max_empty_results ?? 5;
    const maxRepeatCalls = systemConfig.max_repeat_calls ?? 4;

    // Resuming restores the full loop state, not just the prompt: dropping
    // steps/error budgets would silently hand the run a fresh set of retries
    // and lose the step history from the caller's result.
    const resumed = options.checkpoint ?? null;
    let ctx = resumed
      ? resumeBanner(resumed)
      : options.ctx || (await this.observe());
    let formatErrors = resumed?.formatErrors ?? 0;
    let toolErrors = resumed?.toolErrors ?? 0;
    let emptyResults = 0;
    this.recentCallFingerprints = [];
    const steps: LoopStep[] = resumed ? [...resumed.steps] : [];
    let stepCount = resumed?.stepCount ?? 0;
    this.steps = steps;

    const buildCheckpoint = (
      reason: CheckpointReason,
      blockedPath?: string,
    ): LoopCheckpoint => ({
      version: 1,
      goal,
      ctx,
      stepCount,
      steps,
      formatErrors,
      toolErrors,
      reason,
      blockedPath,
      sessionName: this.runner.sessionName || 'default',
      createdAt: new Date().toISOString(),
    });

    while (true) {
      // Park before spending another planner call. At this point the previous
      // iteration has finished observing, so ctx and the counters are all
      // consistent and there is nothing in flight to serialize.
      if (options.pauseSignal?.requested) {
        this.eventBus.emit('loop_suspended', { stepCount });
        return {
          status: 'suspended',
          steps,
          failure_reason: null,
          checkpoint: buildCheckpoint('user_paused'),
        };
      }

      if (stepCount >= limitSteps) {
        const reason = `Max execution steps reached (${limitSteps})`;
        this.eventBus.emit('loop_aborted', { reason });
        return { status: 'failed', steps, failure_reason: reason };
      }

      // 1. Plan step
      const plan = await this.callPlanner(goal, ctx);
      const finishReason = String(plan.finish_reason || '');

      // 2. Check stop conditions
      const isStop = ['stop', 'end_turn', 'stop_sequence', ''].includes(
        finishReason,
      );
      if (isStop && plan.type !== 'tool_call') {
        const content = this.extractStopContent(plan);
        this.eventBus.emit('final_answer', { content });
        return {
          status: 'completed',
          final_content: content,
          steps,
          failure_reason: null,
        };
      }

      const isAbnormal = [
        'length',
        'content_filter',
        'error',
        'max_tokens',
      ].includes(finishReason);
      if (isAbnormal) {
        const reason = `Loop terminated due to finish_reason: ${finishReason}`;
        this.eventBus.emit('loop_aborted', { reason });
        return { status: 'failed', steps, failure_reason: reason };
      }

      // 3. Validate tool call format
      // Note: check both typed ToolCallResult and legacy plain objects that have a 'tool' field
      const planAsAny = plan as unknown as Record<string, unknown>;
      const planTool =
        plan.type === 'tool_call'
          ? plan.tool
          : typeof planAsAny.tool === 'string' && planAsAny.tool
            ? planAsAny.tool
            : undefined;
      if (!planTool) {
        formatErrors++;
        const thought =
          plan.type === 'text'
            ? plan.content
            : plan.type === 'tool_call'
              ? plan.thought
              : undefined;
        if (thought?.trim()) {
          this.eventBus.emit('thought', {
            content: thought,
            streamed_live: plan.streamedLive,
          });
        } else {
          this.eventBus.emit('no_response', {});
        }

        if (formatErrors >= maxFmtErrs) {
          this.eventBus.emit('loop_aborted', { reason: 'format_errors' });
          return {
            status: 'failed',
            steps,
            failure_reason: `Max format errors reached (${maxFmtErrs})`,
          };
        }
        ctx = this.injectFormatError(ctx);
        continue;
      }

      // Emit thought
      const thought = plan.thought;
      if (thought?.trim()) {
        this.eventBus.emit('thought', {
          content: thought,
          streamed_live: plan.streamedLive,
        });
      }

      const toolName = planTool;
      formatErrors = 0;

      // 4. Act step
      stepCount++;
      let result: ToolResult;
      try {
        result = await this.executeTool(plan);
      } catch (err: unknown) {
        const errMsg = (err as Error).message || String(err);
        if (
          errMsg.includes('disconnected') ||
          errMsg.includes('abort') ||
          errMsg.includes('Interrupted')
        ) {
          throw err;
        }
        result = {
          status: 'failed',
          error: errMsg,
          advice: 'The tool execution process crashed unexpectedly.',
        };
      }
      steps.push({
        tool: toolName,
        args:
          plan.type === 'tool_call'
            ? plan.args || {}
            : (planAsAny.args as Record<string, unknown>) || {},
        summary:
          plan.type === 'tool_call'
            ? (plan.summary ?? null)
            : ((planAsAny.summary as string | null) ?? null),
        result,
      });

      const status = String(result.status || '');
      if (status === 'sandbox_locked') {
        this.eventBus.emit('loop_aborted', { reason: 'sandbox_path_blocked' });
        return {
          status: 'failed',
          steps,
          failure_reason: 'sandbox_path_blocked',
          blocked_path: result.sandbox_violation ?? null,
          checkpoint: buildCheckpoint(
            'sandbox_path_blocked',
            result.sandbox_violation?.path,
          ),
        };
      }
      if (['blocked', 'upgrade_required', 'failed'].includes(status)) {
        toolErrors++;
        this.eventBus.emit('tool_halted', {
          tool: toolName,
          status,
          advice: result.advice ?? null,
        });
        if (toolErrors >= maxToolErrs) {
          this.eventBus.emit('loop_aborted', { reason: 'tool_errors' });
          return {
            status: 'failed',
            steps,
            failure_reason: `Max tool errors reached (${maxToolErrs})`,
          };
        }
        ctx = this.injectToolError(ctx, toolName, result);
        continue;
      } else {
        toolErrors = 0;
      }

      // --- Empty result detection ---
      // A tool that returns status:ok but an empty/blank output is not a true
      // success — the agent gained nothing. Count these separately so the loop
      // doesn't spin indefinitely on queries that produce no data.
      const rawOutput = this.stringifyToolResult(result);
      const isEmptyOutput =
        !rawOutput || rawOutput.trim().length === 0 || rawOutput === '{}';
      if (isEmptyOutput) {
        emptyResults++;
        this.eventBus.emit('empty_result', { tool: toolName, count: emptyResults });
        if (emptyResults >= maxEmptyResults) {
          this.eventBus.emit('loop_aborted', { reason: 'empty_results' });
          return {
            status: 'failed',
            steps,
            failure_reason: `Max consecutive empty results reached (${maxEmptyResults}). The agent was unable to retrieve useful data.`,
          };
        }
      } else {
        emptyResults = 0;
      }

      // --- Repeat-call loop detection ---
      // If the agent calls the exact same tool with the same argument structure
      // N times in a row, it's stuck. Fingerprint = toolName + sorted arg keys.
      const callFp = this.buildCallFingerprint(
        toolName,
        plan.type === 'tool_call' ? (plan.args ?? {}) : ((plan as unknown as Record<string, unknown>).args as Record<string, unknown> ?? {}),
      );
      this.recentCallFingerprints.push(callFp);
      if (this.recentCallFingerprints.length > maxRepeatCalls) {
        this.recentCallFingerprints.shift();
      }
      if (
        this.recentCallFingerprints.length >= maxRepeatCalls &&
        this.recentCallFingerprints.every((fp) => fp === callFp)
      ) {
        this.eventBus.emit('loop_aborted', { reason: 'repeat_calls' });
        return {
          status: 'failed',
          steps,
          failure_reason: `Repeat-call loop detected: '${toolName}' called ${maxRepeatCalls} times in a row with the same argument structure. Switch to a different strategy.`,
        };
      }

      // 5. Observe step — if agent just woke from sleep, annotate the fresh context
      if (status === 'sleeping') {
        const freshCtx = await this.observe();
        const sleptFor = (result as Record<string, unknown>).slept_seconds;
        const reason = (result as Record<string, unknown>).reason;
        const banner = [
          `[WAKE] You slept for ${sleptFor} seconds and have been automatically resumed.`,
          reason ? `Reason you gave: ${reason}` : null,
          'Review the context below — check your background processes and decide next steps.',
        ]
          .filter(Boolean)
          .join('\n');
        ctx = `${banner}\n\n${freshCtx}`;
      } else if (status === 'deferred') {
        const resumeAt = String(
          (result as Record<string, unknown>).resume_at || '',
        );
        const reason = String((result as Record<string, unknown>).reason || '');
        const resumeTime = new Date(resumeAt).getTime();
        const now = Date.now();
        const sleepMs = Math.max(1000, resumeTime - now);

        this.eventBus.emit('thought', {
          content: `[DEFER] Workflow deferred until ${resumeAt} (reason: ${reason}). Waiting...`,
        });

        await new Promise((resolve) => setTimeout(resolve, sleepMs));

        const freshCtx = await this.observe();
        const banner = [
          `[WAKE] Workflow resumed. Deferred state until ${resumeAt} has expired.`,
          reason ? `Reason: ${reason}` : null,
          'Review the context below and decide next steps.',
        ]
          .filter(Boolean)
          .join('\n');
        ctx = `${banner}\n\n${freshCtx}`;
      } else {
        ctx = this.appendLastToolResult(await this.observe(), toolName, result);
      }
    }
  }

  private async observe(): Promise<string> {
    try {
      const result = await this.runner.observe();
      // runner.observe() returns ContextPayload; mocks may return a string
      if (typeof result === 'string') return result;
      return (result as { toMarkdown(): string }).toMarkdown();
    } catch (e: unknown) {
      const msg = (e as Error).message ?? String(e);
      return `[Context overflow] ${msg}`;
    }
  }

  private async callPlanner(
    goal: string,
    ctx: string,
  ): Promise<
    ParseResult & { finish_reason?: string | null; streamedLive?: boolean }
  > {
    this.eventBus.emit('plan_stream_start', {});
    let streamedLive = false;
    try {
      const result = await this.runner.planStream(goal, ctx, (ev) => {
        if (ev?.type === 'delta' && ev.text) streamedLive = true;
        this.eventBus.emit('plan_event', ev);
      });
      return { ...result, streamedLive };
    } finally {
      this.eventBus.emit('plan_stream_end', {});
    }
  }

  private async executeTool(plan: ParseResult): Promise<ToolResult> {
    const planAsRecord = plan as unknown as Record<string, unknown>;
    const tool =
      plan.type === 'tool_call'
        ? plan.tool
        : (planAsRecord.tool as string | undefined);
    if (!tool) {
      throw new Error('Expected tool_call plan');
    }
    const call: ToolCall = {
      tool,
      args:
        (plan.type === 'tool_call'
          ? plan.args
          : (planAsRecord.args as Record<string, unknown> | undefined)) || {},
      summary:
        (plan.type === 'tool_call'
          ? plan.summary
          : (planAsRecord.summary as string | undefined)) ?? undefined,
    };
    return await this.runner.runCall(call);
  }

  private extractStopContent(plan: ParseResult): string {
    if (!plan) return '';
    if (plan.type === 'text') {
      return plan.content;
    }
    // Support legacy plain objects without a 'type' field that carry 'content'
    const p = plan as unknown as Record<string, unknown>;
    if (typeof p.content === 'string') {
      return p.content;
    }
    return '';
  }

  private injectFormatError(ctx: string): string {
    const msg = [
      '[SYSTEM ERROR] Your last response was not parsed as a valid tool call JSON.',
      '- To call a tool: output ONLY a single valid JSON object. Example:',
      '  {"tool": "bash_command", "args": {"command": "ls"}, "summary": "List files"}',
      '- To finish the task: provide your final answer as plain text. The system will detect your natural stop and complete automatically.',
      'Do NOT write text outside the JSON object when calling a tool. Try again now.',
    ].join('\n');
    return `${msg}\n\n${ctx}`;
  }

  private injectToolError(
    ctx: string,
    toolName: string,
    result: ToolResult,
  ): string {
    return (
      `[TOOL ERROR] Tool '${toolName}' was ${result.status}: ${result.advice || result.error || 'No explanation provided.'}\n` +
      `Please choose a different approach or tool.\n\n${ctx}`
    );
  }

  private appendLastToolResult(
    ctx: string,
    toolName: string,
    result: ToolResult,
  ): string {
    const output = this.stringifyToolResult(result);
    const isEmptyOutput =
      !output || output.trim().length === 0 || output === '{}';
    const guidance = isEmptyOutput
      ? [
          `⚠️  WARNING: Tool '${toolName}' returned an EMPTY result.`,
          'Do NOT retry this tool with only minor parameter changes.',
          'You MUST switch to a completely different approach, tool, or data source.',
          'If you have exhausted all reasonable approaches, provide your best answer based on what you know.',
        ].join(' ')
      : 'Next step guidance: if this successful tool result satisfies the current user task, finish with a final answer instead of repeating completed tool calls.';
    return [
      ctx,
      '## MOST RECENT TOOL RESULT',
      `Tool: ${toolName}`,
      `Status: ${String(result.status || 'ok')}`,
      'Result:',
      isEmptyOutput ? '(empty)' : output,
      guidance,
    ].join('\n');
  }

  private stringifyToolResult(result: ToolResult): string {
    const resultRecord = result as Record<string, unknown>;
    const candidates = [
      resultRecord.output,
      resultRecord.content,
      resultRecord.stdout,
      resultRecord.stderr,
      resultRecord.message,
    ];
    const found = candidates.find(
      (value) => value !== undefined && value !== null && String(value).trim(),
    );
    if (found !== undefined) {
      return String(found);
    }
    return JSON.stringify(result);
  }

  /**
   * Builds a lightweight fingerprint for loop detection.
   * Uses toolName + sorted argument keys (not values) so that minor value
   * tweaks (e.g. changing a query string) are still detected as repeats.
   */
  private buildCallFingerprint(
    toolName: string,
    args: Record<string, unknown>,
  ): string {
    const argKeys = Object.keys(args || {}).sort().join(',');
    return `${toolName}:[${argKeys}]`;
  }
}

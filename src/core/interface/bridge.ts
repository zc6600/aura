import {
  AgentLoop,
  type AgentLoopResult,
  type PauseSignal,
} from '../kernel/agentLoop.js';
import type { LoopCheckpoint } from '../kernel/checkpoint.js';
import type { PlanEvent, ToolCall, ToolResult } from '../kernel/interfaces.js';
import { Runner } from '../kernel/runner.js';
import { MemoryEventBus } from '../memory/eventBus.js';

interface LoopAbortedPayload {
  reason: string;
}

interface MetabolismPayload {
  event_count?: number;
  total_chars?: number;
  deleted_count?: number;
}

export class Bridge {
  public readonly runner: Runner;
  public lastResult: AgentLoopResult | null = null;
  private callbacks: Record<string, (...args: never[]) => unknown> = {};
  private subscribed = false;

  constructor(projectPath: string, options: { runner?: Runner } = {}) {
    this.runner = options.runner || new Runner(projectPath);
  }

  /**
   * Register callbacks for UI events
   */
  public on<T extends unknown[]>(
    event: string,
    callback: (...args: T) => unknown,
  ): void {
    this.callbacks[event] = callback as unknown as (
      ...args: never[]
    ) => unknown;
  }

  private notify(event: string, ...args: unknown[]): void {
    if (this.callbacks[event]) {
      (this.callbacks[event] as unknown as (...args: unknown[]) => unknown)(
        ...args,
      );
    }
  }

  /**
   * Main entry point for processing a user turn
   */
  public async chat(
    input: string,
    options: {
      auto_mode?: boolean;
      max_steps?: number | null;
      pauseSignal?: PauseSignal | null;
      checkpoint?: LoopCheckpoint | null;
    } = {},
  ): Promise<void> {
    const autoMode = options.auto_mode || false;
    this.lastResult = null;
    this.runner.recordUserInput(input);

    // Start a new job for this turn
    this.runner.startJob({ input, auto_mode: autoMode });

    this.setupRunnerSubscriptions();

    // Create EventBus for AgentLoop
    const bus = new MemoryEventBus();

    // Track streaming state for UI waiting indicator
    let streamed = false;
    let startTime: number | null = null;

    bus.on('plan_stream_start', () => {
      streamed = false;
      startTime = Date.now();
      this.notify('on_waiting', startTime, () => streamed);
    });

    bus.on('plan_event', (payload: unknown) => {
      const planPayload = payload as PlanEvent;
      if (planPayload?.type === 'delta') {
        if (!streamed) {
          streamed = true;
          this.notify('on_clear_waiting');
        }
        this.notify('on_token', planPayload.text || '');
      }
    });

    bus.on('plan_stream_end', () => {
      this.notify('on_stream_end');
    });

    bus.on('final_answer', (payload: unknown) => {
      const finalAnswerPayload = payload as { content: string };
      this.notify('on_final_answer', finalAnswerPayload.content || '');
    });

    bus.on('tool_start', (payload: unknown) => {
      const p = payload as {
        tool: string;
        summary?: string | null;
        args?: unknown;
      };
      this.notify('on_tool_start', p.tool, p.summary, p.args);
    });

    bus.on('tool_executing', () => {
      this.notify('on_tool_executing');
    });

    bus.on('tool_result', (payload: unknown) => {
      const p = payload as { tool: string; result: ToolResult };
      this.notify('on_tool_result', p.result);
    });

    bus.on('tool_halted', (payload: unknown) => {
      const toolResultPayload = payload as ToolResult;
      this.notify(
        'on_warning',
        `Tool '${toolResultPayload.tool}' halted (${toolResultPayload.status}): ${toolResultPayload.advice || ''}`,
      );
    });

    bus.on('thought', (payload: unknown) => {
      const thoughtPayload = payload as {
        content: string;
        streamed_live?: boolean;
      };
      // This bridge already renders the model's text live via on_token as it
      // streams in (see plan_event above) — if that happened, don't also
      // print the same text again here as a "thought" recap.
      if (thoughtPayload.streamed_live) return;
      const elapsed = startTime ? (Date.now() - startTime) / 1000 : 0;
      this.notify('on_thought', thoughtPayload.content || '', elapsed);
    });

    bus.on('no_response', () => {
      this.notify(
        'on_warning',
        'No response. Check LLM configuration or API key.',
      );
    });

    bus.on('loop_aborted', (payload: unknown) => {
      const loopAbortedPayload = payload as LoopAbortedPayload;
      if (loopAbortedPayload.reason === 'format_errors') {
        this.notify(
          'on_warning',
          'Agent failed to produce a valid tool call after 5 attempts. Aborting.',
        );
      } else if (loopAbortedPayload.reason === 'tool_errors') {
        this.notify('on_warning', 'Too many tool errors (3). Aborting.');
      } else if (loopAbortedPayload.reason === 'empty_results') {
        this.notify(
          'on_warning',
          'Agent stopped: too many consecutive empty results. The agent could not retrieve useful data through repeated queries. Try rephrasing the goal or providing more context.',
        );
      } else if (loopAbortedPayload.reason === 'repeat_calls') {
        this.notify(
          'on_warning',
          'Agent stopped: detected a tool-call loop (same tool called repeatedly with no progress). The agent is stuck. Try rephrasing the goal or breaking it into smaller steps.',
        );
      } else {
        this.notify(
          'on_warning',
          `Agent loop aborted: ${loopAbortedPayload.reason || ''}`,
        );
      }
    });

    // Metabolism events from Runner
    bus.on('metabolism_start', (payload: unknown) => {
      const metabolismPayload = payload as MetabolismPayload;
      this.notify(
        'on_thought',
        `🔄 Optimizing memory... (${metabolismPayload.event_count || 0} events, ${metabolismPayload.total_chars || 0} chars)`,
        0,
      );
    });

    bus.on('metabolism_summary', (payload: unknown) => {
      const _metabolismSummaryPayload = payload as { content: string };
      // Optional: notify('on_thought', `📝 Summary: ${metabolismSummaryPayload.content}`, 0);
    });

    bus.on('metabolism_complete', (payload: unknown) => {
      const metabolismPayload = payload as MetabolismPayload;
      this.notify(
        'on_thought',
        `✅ Memory optimized (removed ${metabolismPayload.deleted_count || 0} old events)`,
        0,
      );
    });

    // Instantiate and run AgentLoop
    const agentLoop = new AgentLoop(this.runner, { eventBus: bus });

    try {
      const res = await agentLoop.run(input, {
        max_steps: options.max_steps,
        pauseSignal: options.pauseSignal,
        checkpoint: options.checkpoint,
      });
      this.lastResult = res;
      if (res.status === 'completed') {
        this.runner.endJob('completed');
      } else if (res.status === 'suspended') {
        // A parked run is not a failure. Job status has no 'suspended' member,
        // so close the job cleanly and let the checkpoint carry the state.
        this.notify('on_suspended', res.checkpoint ?? null);
        this.runner.endJob('completed');
      } else {
        this.runner.endJob(
          'failed',
          new Error(res.failure_reason || 'Agent loop aborted'),
        );
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message?.includes('Interrupted')) {
        this.notify('on_warning', 'Interrupted by user');
        this.runner.endJob('failed', new Error('Interrupted by user'));
        this.lastResult = {
          status: 'failed',
          steps: agentLoop.completedSteps,
          failure_reason: 'Interrupted by user',
        };
      } else {
        this.notify('on_error', (e as Error).message);
        this.runner.endJob('failed', e as Error);
        throw e;
      }
    }
  }

  /**
   * Expose hooks to allow external registration
   */
  public get hooks() {
    return this.runner.hooks;
  }

  /**
   * Helper to register the standard dangerous tool confirmation hook
   */
  public registerConfirmationHook(dangerousTools: string[]): void {
    this.runner.hooks.register(
      'before_tool_execution',
      async (...args: unknown[]) => {
        const tool = args[0] as string;
        const _args = args[1] as Record<string, unknown>;
        const isAuto =
          this.runner.currentJob?.metadata?.auto_mode ||
          this.runner.autoMode ||
          false;
        if (isAuto) {
          return true;
        }

        if (dangerousTools.includes(String(tool))) {
          if (this.callbacks.ask_confirmation) {
            const askConfirmation = this.callbacks
              .ask_confirmation as unknown as (
              message: string,
            ) => boolean | Promise<boolean>;
            return await askConfirmation(`DANGEROUS TOOL: ${tool}. Execute?`);
          }
        }
        return true;
      },
    );
  }

  private setupRunnerSubscriptions(): void {
    if (this.subscribed) return;

    this.runner.on('tool_start', (payload: ToolCall) => {
      this.notify('on_tool_start', payload.tool, payload.summary, payload.args);
    });

    this.runner.on('tool_executing', () => {
      this.notify('on_tool_executing');
    });

    this.runner.on('tool_blocked', (payload: { reason: string }) => {
      this.notify('on_warning', `Tool blocked: ${payload.reason || ''}`);
    });

    this.runner.on('tool_result', (payload: { result: ToolResult }) => {
      this.notify('on_tool_result', payload.result);
    });

    this.subscribed = true;
  }
}

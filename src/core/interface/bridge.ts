import { Runner } from '../kernel/runner.js';
import { AgentLoop } from '../kernel/agentLoop.js';
import { MemoryEventBus } from '../memory/eventBus.js';

export class Bridge {
  public readonly runner: Runner;
  private callbacks: Record<string, Function> = {};
  private subscribed = false;

  constructor(projectPath: string, options: { runner?: Runner } = {}) {
    this.runner = options.runner || new Runner(projectPath);
  }

  /**
   * Register callbacks for UI events
   */
  public on(event: string, callback: Function): void {
    this.callbacks[event] = callback;
  }

  private notify(event: string, ...args: any[]): void {
    if (this.callbacks[event]) {
      this.callbacks[event](...args);
    }
  }

  /**
   * Main entry point for processing a user turn
   */
  public async chat(input: string, options: { auto_mode?: boolean } = {}): Promise<void> {
    const autoMode = options.auto_mode || false;
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

    bus.on('plan_event', (payload: any) => {
      if (payload?.type === 'delta') {
        if (!streamed) {
          streamed = true;
          this.notify('on_clear_waiting');
        }
        this.notify('on_token', payload.text || '');
      }
    });

    bus.on('plan_stream_end', () => {
      this.notify('on_stream_end');
    });

    bus.on('final_answer', (payload: any) => {
      this.notify('on_final_answer', payload.content || '');
    });

    bus.on('tool_halted', (payload: any) => {
      this.notify('on_warning', `Tool '${payload.tool}' halted (${payload.status}): ${payload.advice || ''}`);
    });

    bus.on('thought', (payload: any) => {
      const elapsed = startTime ? (Date.now() - startTime) / 1000 : 0;
      this.notify('on_thought', payload.content || '', elapsed);
    });

    bus.on('no_response', () => {
      this.notify('on_warning', 'No response. Check LLM configuration or API key.');
    });

    bus.on('loop_aborted', (payload: any) => {
      if (payload.reason === 'format_errors') {
        this.notify('on_warning', 'Agent failed to produce a valid tool call after 5 attempts. Aborting.');
      } else if (payload.reason === 'tool_errors') {
        this.notify('on_warning', 'Too many tool errors (3). Aborting.');
      } else {
        this.notify('on_warning', `Agent loop aborted: ${payload.reason || ''}`);
      }
    });

    // Metabolism events from Runner
    bus.on('metabolism_start', (payload: any) => {
      this.notify('on_thought', `🔄 Optimizing memory... (${payload.event_count || 0} events, ${payload.total_chars || 0} chars)`, 0);
    });

    bus.on('metabolism_summary', (payload: any) => {
      // Optional: notify('on_thought', `📝 Summary: ${payload.content}`, 0);
    });

    bus.on('metabolism_complete', (payload: any) => {
      this.notify('on_thought', `✅ Memory optimized (removed ${payload.deleted_count || 0} old events)`, 0);
    });

    // Instantiate and run AgentLoop
    const agentLoop = new AgentLoop(this.runner, { eventBus: bus });

    try {
      const res = await agentLoop.run(input);
      if (res.status === 'completed') {
        this.runner.endJob('completed');
      } else {
        this.runner.endJob('failed', new Error(res.failure_reason || 'Agent loop aborted'));
      }
    } catch (e: any) {
      if (e.message?.includes('Interrupted')) {
        this.notify('on_warning', 'Interrupted by user');
        this.runner.endJob('failed', new Error('Interrupted by user'));
      } else {
        this.notify('on_error', e.message);
        this.runner.endJob('failed', e);
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
    this.runner.hooks.register('before_tool_execution', async (payload: any) => {
      const tool = payload?.tool;
      const isAuto = this.runner.currentJob?.metadata?.auto_mode || false;
      if (isAuto) {
        return true;
      }

      if (dangerousTools.includes(String(tool))) {
        if (this.callbacks.ask_confirmation) {
          return await this.callbacks.ask_confirmation(`DANGEROUS TOOL: ${tool}. Execute?`);
        }
      }
      return true;
    });
  }

  private setupRunnerSubscriptions(): void {
    if (this.subscribed) return;

    this.runner.on('tool_start', (payload: any) => {
      this.notify('on_tool_start', payload.tool, payload.summary, payload.args);
    });

    this.runner.on('tool_executing', () => {
      this.notify('on_tool_executing');
    });

    this.runner.on('tool_blocked', (payload: any) => {
      this.notify('on_warning', `Tool blocked: ${payload.reason || ''}`);
    });

    this.runner.on('tool_result', (payload: any) => {
      this.notify('on_tool_result', payload.result);
    });

    this.subscribed = true;
  }
}

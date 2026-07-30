import { beforeEach, describe, expect, it } from 'vitest';
import { AgentLoop } from '../../src/core/kernel/agentLoop.js';
import type { LoopCheckpoint } from '../../src/core/kernel/checkpoint.js';
import type {
  PlanResult,
  ToolCall,
  ToolResult,
} from '../../src/core/kernel/interfaces.js';
import { MemoryEventBus } from '../../src/core/memory/eventBus.js';

class MockRunner {
  public plans: Partial<PlanResult>[] = [];
  public toolResults: Partial<ToolResult>[] = [];
  public observations: string[] = [];
  public config: Record<string, unknown> = {};
  public planCalls: { goal: string; ctx: string | null }[] = [];
  public toolCalls: ToolCall[] = [];
  public observeCalls: boolean[] = [];
  private planIndex = 0;
  private toolIndex = 0;
  private obsIndex = 0;

  public async planStream(
    goal: string,
    ctx: string | null,
    onEvent?: (ev: { type: string; text: string }) => void,
  ): Promise<PlanResult> {
    this.planCalls.push({ goal, ctx });
    const plan =
      this.plans[this.planIndex] || this.plans[this.plans.length - 1];
    this.planIndex++;
    if (onEvent) {
      onEvent({ type: 'delta', text: 'thinking...' });
    }
    return plan as PlanResult;
  }

  public async runCall(call: ToolCall): Promise<ToolResult> {
    this.toolCalls.push(call);
    const result =
      this.toolResults[this.toolIndex] ||
      this.toolResults[this.toolResults.length - 1];
    this.toolIndex++;
    return (result as ToolResult) || { status: 'ok', output: 'ok' };
  }

  public async observe(): Promise<string> {
    this.observeCalls.push(true);
    const obs =
      this.observations[this.obsIndex] ||
      this.observations[this.observations.length - 1];
    this.obsIndex++;
    return obs || 'mock observation';
  }

  public loadConfig(): Record<string, unknown> {
    return this.config;
  }

  public recordUserInput(_input: string): void {}
}

describe('AgentLoop', () => {
  let runner: MockRunner;
  let events: [string, any][] = [];
  let eventBus: MemoryEventBus;
  let loop: AgentLoop;

  beforeEach(() => {
    runner = new MockRunner();
    events = [];
    eventBus = new MemoryEventBus();
    eventBus.subscribe('*', (event: any, payload: any) => {
      events.push([event, payload]);
    });
    loop = new AgentLoop(runner as any, { eventBus });
  });

  it('test_completes_when_llm_returns_stop', async () => {
    runner.plans = [
      {
        type: 'text',
        content: 'Task completed successfully!',
        thought: 'Task is complete',
        finish_reason: 'stop',
      },
    ];

    const result = await loop.run('do something');

    expect(result.status).toBe('completed');
    expect(result.final_content).toBe('Task completed successfully!');
    expect(result.steps).toEqual([]);
    expect(result.failure_reason).toBeNull();

    const eventTypes = events.map((e) => e[0]);
    expect(eventTypes).toContain('plan_stream_start');
    expect(eventTypes).toContain('plan_stream_end');
    expect(eventTypes).toContain('final_answer');
  });

  it('test_executes_single_tool_then_completes', async () => {
    runner.plans = [
      {
        type: 'tool_call',
        tool: 'bash',
        args: { command: 'ls' },
        summary: 'List files',
        thought: 'Need to list files',
        finish_reason: 'tool_calls',
      },
      {
        type: 'text',
        content: 'Found file1.rb and file2.rb',
        thought: 'Task complete',
        finish_reason: 'stop',
      },
    ];
    runner.toolResults = [{ status: 'ok', output: 'file1.rb\nfile2.rb' }];

    const result = await loop.run('list files');

    expect(result.status).toBe('completed');
    expect(result.final_content).toBe('Found file1.rb and file2.rb');
    expect(result.steps.length).toBe(1);
    expect(result.steps[0].tool).toBe('bash');
    expect(result.steps[0].args).toEqual({ command: 'ls' });
    expect(result.steps[0].summary).toBe('List files');
  });

  it('test_aborts_on_max_steps', async () => {
    runner.config = { system: { max_steps: 3 } };
    runner.plans = Array(10).fill({
      type: 'tool_call',
      tool: 'bash',
      args: {},
      thought: 'running command',
      finish_reason: 'tool_calls',
    });
    runner.toolResults = Array(10).fill({ status: 'ok', output: 'ok' });

    const result = await loop.run('infinite task');

    expect(result.status).toBe('failed');
    expect(result.failure_reason).toMatch(/Max execution steps reached \(3\)/);
    expect(result.steps.length).toBe(3);

    const abortEvents = events.filter((e) => e[0] === 'loop_aborted');
    expect(abortEvents.length).toBe(1);
    expect(abortEvents[0][1].reason).toMatch(/Max execution steps reached/);
  });

  it('test_aborts_on_format_errors', async () => {
    runner.config = { system: { max_format_errors: 2 } };
    runner.plans = [
      {
        type: 'text',
        content: 'thinking...',
        thought: 'thinking...',
        finish_reason: 'tool_calls',
      },
      {
        type: 'text',
        content: 'still thinking',
        thought: 'still thinking',
        finish_reason: 'tool_calls',
      },
    ];

    const result = await loop.run('do task');

    expect(result.status).toBe('failed');
    expect(result.failure_reason).toMatch(/Max format errors reached \(2\)/);

    const thoughtEvents = events.filter((e) => e[0] === 'thought');
    expect(thoughtEvents.length).toBe(2);
  });

  it('test_aborts_on_tool_errors', async () => {
    runner.config = { system: { max_tool_errors: 2 } };
    runner.plans = Array(5).fill({
      type: 'tool_call',
      tool: 'bash',
      args: {},
      thought: 'running command',
      finish_reason: 'tool_calls',
    });
    runner.toolResults = Array(5).fill({
      status: 'failed',
      advice: 'permission denied',
    });

    const result = await loop.run('risky task');

    expect(result.status).toBe('failed');
    expect(result.failure_reason).toMatch(/Max tool errors reached \(2\)/);
    expect(result.steps.length).toBe(2);

    const haltedEvents = events.filter((e) => e[0] === 'tool_halted');
    expect(haltedEvents.length).toBe(2);
    expect(haltedEvents[0][1].tool).toBe('bash');
    expect(haltedEvents[0][1].status).toBe('failed');
  });

  it('test_aborts_on_repeat_calls_with_identical_args', async () => {
    runner.config = { system: { max_repeat_calls: 4 } };
    runner.plans = Array(6).fill({
      type: 'tool_call',
      tool: 'bash_command',
      args: { command: 'ls -la' },
      thought: 'checking files',
      finish_reason: 'tool_calls',
    });
    runner.toolResults = Array(6).fill({ status: 'ok', output: 'file1.rb' });

    const result = await loop.run('stuck task');

    expect(result.status).toBe('failed');
    expect(result.failure_reason).toMatch(/Repeat-call loop detected/);
    expect(result.steps.length).toBe(4);

    const abortedEvents = events.filter((e) => e[0] === 'loop_aborted');
    expect(abortedEvents.length).toBe(1);
    expect(abortedEvents[0][1].reason).toBe('repeat_calls');
  });

  it('test_does_not_abort_on_repeat_calls_when_arg_values_differ', async () => {
    // Regression test: four consecutive bash_command calls that share the
    // same argument shape (a single `command` key) but carry genuinely
    // different content should NOT be flagged as a repeat-call loop. The
    // fingerprint must be sensitive to argument values, not just their keys.
    runner.config = { system: { max_repeat_calls: 4 } };
    runner.plans = [
      {
        type: 'tool_call',
        tool: 'bash_command',
        args: { command: 'curl https://example.com/search?q=a' },
        finish_reason: 'tool_calls',
      },
      {
        type: 'tool_call',
        tool: 'bash_command',
        args: { command: 'curl https://example.com/search?q=b' },
        finish_reason: 'tool_calls',
      },
      {
        type: 'tool_call',
        tool: 'bash_command',
        args: { command: 'curl https://example.com/search?q=c' },
        finish_reason: 'tool_calls',
      },
      {
        type: 'tool_call',
        tool: 'bash_command',
        args: { command: 'curl https://example.com/search?q=d' },
        finish_reason: 'tool_calls',
      },
      {
        type: 'text',
        content: 'Found the answer',
        finish_reason: 'stop',
      },
    ];
    runner.toolResults = Array(4).fill({ status: 'ok', output: 'result' });

    const result = await loop.run('progressive search task');

    expect(result.status).toBe('completed');
    expect(result.final_content).toBe('Found the answer');
    expect(result.steps.length).toBe(4);

    const abortedEvents = events.filter((e) => e[0] === 'loop_aborted');
    expect(abortedEvents.length).toBe(0);
  });

  it('test_escalates_immediately_on_sandbox_locked', async () => {
    runner.config = { system: { max_tool_errors: 5 } };
    runner.plans = [
      {
        type: 'tool_call',
        tool: 'bash_command',
        args: { command: 'cat /etc/passwd' },
        thought: 'reading outside path',
        finish_reason: 'tool_calls',
      },
    ];
    runner.toolResults = [
      {
        status: 'sandbox_locked',
        advice: 'human approval required',
        sandbox_violation: {
          path: '/etc/passwd',
          attempts: 3,
          threshold: 3,
        },
      },
    ];

    const result = await loop.run('read a system file');

    // Stops on the very step it escalates, not after burning the full
    // max_tool_errors budget — a human needs to act, retrying won't help.
    expect(result.status).toBe('failed');
    expect(result.failure_reason).toBe('sandbox_path_blocked');
    expect(result.steps.length).toBe(1);
    expect(result.blocked_path).toEqual({
      path: '/etc/passwd',
      attempts: 3,
      threshold: 3,
    });
    expect(result.checkpoint).toMatchObject({
      version: 1,
      goal: 'read a system file',
      ctx: 'mock observation',
      stepCount: 1,
      reason: 'sandbox_path_blocked',
      blockedPath: '/etc/passwd',
      formatErrors: 0,
      toolErrors: 0,
    });
    // The escalating step is carried in the checkpoint, so a resumed run keeps
    // the history rather than restarting from an empty step list.
    expect(result.checkpoint?.steps.length).toBe(1);

    const abortedEvents = events.filter((e) => e[0] === 'loop_aborted');
    expect(abortedEvents.length).toBe(1);
    expect(abortedEvents[0][1].reason).toBe('sandbox_path_blocked');
  });

  it('test_suspends_at_iteration_boundary_and_preserves_loop_state', async () => {
    const pauseSignal = { requested: false };
    runner.plans = [
      {
        type: 'tool_call',
        tool: 'bash',
        args: { command: 'ls' },
        thought: 'listing',
        finish_reason: 'tool_calls',
      },
    ];
    // Requesting the pause from inside the tool proves the current step is
    // allowed to finish rather than being torn down mid-execution.
    runner.runCall = async (call) => {
      runner.toolCalls.push(call);
      pauseSignal.requested = true;
      return { status: 'ok', output: 'listed' };
    };

    const result = await loop.run('list things', { pauseSignal });

    expect(result.status).toBe('suspended');
    expect(result.failure_reason).toBeNull();
    // The in-flight step completed and was recorded before parking.
    expect(result.steps.length).toBe(1);
    expect(result.steps[0].tool).toBe('bash');
    expect(result.steps[0].result.status).toBe('ok');
    expect(result.checkpoint).toMatchObject({
      version: 1,
      goal: 'list things',
      stepCount: 1,
      reason: 'user_paused',
      formatErrors: 0,
      toolErrors: 0,
    });
    expect(result.checkpoint?.steps.length).toBe(1);

    const suspendedEvents = events.filter((e) => e[0] === 'loop_suspended');
    expect(suspendedEvents.length).toBe(1);
    expect(suspendedEvents[0][1].stepCount).toBe(1);
  });

  it('test_resume_continues_step_count_and_keeps_history', async () => {
    const checkpoint: LoopCheckpoint = {
      version: 1,
      goal: 'finish the job',
      ctx: 'context as of the pause',
      stepCount: 2,
      steps: [
        {
          tool: 'bash',
          args: { command: 'step one' },
          summary: null,
          result: { status: 'ok' },
        },
        {
          tool: 'bash',
          args: { command: 'step two' },
          summary: null,
          result: { status: 'ok' },
        },
      ],
      formatErrors: 0,
      toolErrors: 1,
      reason: 'user_paused' as const,
      sessionName: 'default',
      createdAt: new Date().toISOString(),
    };
    runner.plans = [
      {
        type: 'text',
        content: 'All done.',
        finish_reason: 'stop',
      },
    ];

    const result = await loop.run('finish the job', { checkpoint });

    expect(result.status).toBe('completed');
    // History survives the round trip instead of restarting from zero.
    expect(result.steps.length).toBe(2);
    expect(result.steps.map((s) => s.args.command)).toEqual([
      'step one',
      'step two',
    ]);
    // The resumed run re-primes the model with the saved context plus a banner
    // rather than re-observing from scratch.
    expect(runner.planCalls[0].ctx).toContain('[RESUMED]');
    expect(runner.planCalls[0].ctx).toContain('context as of the pause');
    expect(runner.observeCalls.length).toBe(0);
  });

  it('test_resume_respects_total_step_budget', async () => {
    // Restored stepCount counts against max_steps, so a resumed run cannot
    // silently buy itself a fresh budget.
    const checkpoint: LoopCheckpoint = {
      version: 1,
      goal: 'long job',
      ctx: 'saved ctx',
      stepCount: 5,
      steps: [],
      formatErrors: 0,
      toolErrors: 0,
      reason: 'user_paused' as const,
      sessionName: 'default',
      createdAt: new Date().toISOString(),
    };
    runner.plans = [
      {
        type: 'tool_call',
        tool: 'bash',
        args: { command: 'ls' },
        finish_reason: 'tool_calls',
      },
    ];

    const result = await loop.run('long job', { checkpoint, max_steps: 5 });

    expect(result.status).toBe('failed');
    expect(result.failure_reason).toBe('Max execution steps reached (5)');
    expect(runner.toolCalls.length).toBe(0);
  });

  it('test_aborts_on_length_finish', async () => {
    runner.plans = [
      {
        finish_reason: 'length',
        content: 'truncated response...',
      },
    ];

    const result = await loop.run('long task');

    expect(result.status).toBe('failed');
    expect(result.failure_reason).toMatch(/finish_reason: length/);
  });

  it('test_aborts_on_content_filter_finish', async () => {
    runner.plans = [
      {
        finish_reason: 'content_filter',
        content: 'filtered content',
      },
    ];

    const result = await loop.run('sensitive task');

    expect(result.status).toBe('failed');
    expect(result.failure_reason).toMatch(/finish_reason: content_filter/);
  });

  it('test_aborts_on_error_finish', async () => {
    runner.plans = [
      {
        finish_reason: 'error',
        content: 'LLM error occurred',
      },
    ];

    const result = await loop.run('task with error');

    expect(result.status).toBe('failed');
    expect(result.failure_reason).toMatch(/finish_reason: error/);
  });

  it('test_emits_thought_events', async () => {
    runner.plans = [
      {
        tool: 'read_file',
        args: { path: 'test.rb' },
        thought: 'I should read the file first to understand its structure',
        finish_reason: 'tool_calls',
      },
      { finish_reason: 'stop', content: 'Done' },
    ];
    runner.toolResults = [{ status: 'ok', output: 'content' }];

    await loop.run('analyze file');

    const thoughtEvents = events.filter((e) => e[0] === 'thought');
    expect(thoughtEvents.length).toBe(1);
    expect(thoughtEvents[0][1].content).toMatch(/read the file first/);
  });

  it('test_recovers_from_single_tool_error', async () => {
    runner.plans = [
      { tool: 'bash', args: { command: 'rm' }, finish_reason: 'tool_calls' },
      {
        tool: 'read_file',
        args: { path: 'test.rb' },
        finish_reason: 'tool_calls',
      },
      { finish_reason: 'stop', content: 'Success after retry' },
    ];
    runner.toolResults = [
      { status: 'failed', advice: 'operation not permitted' },
      { status: 'ok', output: 'file content' },
    ];

    const result = await loop.run('recover test');

    expect(result.status).toBe('completed');
    expect(result.final_content).toBe('Success after retry');
    expect(result.steps.length).toBe(2);
    expect(result.steps[0].tool).toBe('bash');
    expect(result.steps[1].tool).toBe('read_file');
  });

  it('test_injects_stdout_when_tool_error_has_no_advice_or_error', async () => {
    // Regression test: bash_command reports failure purely via
    // stdout/stderr/exit_code — it never sets `advice` or `error`. Before
    // the fix, injectToolError() only checked those two fields, so the model
    // was fed a blank "No explanation provided." instead of the actual
    // failure reason (e.g. an HTTP 429 buried in a Python traceback),
    // leaving it unable to tell a rate limit apart from any other failure.
    runner.plans = [
      {
        tool: 'bash_command',
        args: { command: 'curl https://export.arxiv.org/api/query' },
        finish_reason: 'tool_calls',
      },
      { finish_reason: 'stop', content: 'done' },
    ];
    runner.toolResults = [
      {
        status: 'failed',
        stdout: 'urllib.error.HTTPError: HTTP Error 429: Too Many Requests',
        exit_code: 1,
      } as unknown as ToolResult,
    ];

    await loop.run('surface real failure reason');

    expect(runner.planCalls[1].ctx).toMatch(/429: Too Many Requests/);
    expect(runner.planCalls[1].ctx).not.toMatch(/No explanation provided/);
  });

  it('test_tool_error_counter_resets_on_success', async () => {
    runner.config = { system: { max_tool_errors: 2 } };
    runner.plans = [
      { tool: 'bash', args: {}, finish_reason: 'tool_calls' },
      { tool: 'read_file', args: {}, finish_reason: 'tool_calls' },
      { tool: 'bash', args: {}, finish_reason: 'tool_calls' },
      { tool: 'bash', args: {}, finish_reason: 'tool_calls' },
      { finish_reason: 'stop', content: 'completed' },
    ];
    runner.toolResults = [
      { status: 'failed', advice: 'error 1' },
      { status: 'ok', output: 'ok' },
      { status: 'failed', advice: 'error 2' },
      { status: 'ok', output: 'ok' },
    ];

    const result = await loop.run('test reset');

    expect(result.status).toBe('completed');
    expect(result.steps.length).toBe(4);
  });

  it('test_format_error_counter_resets', async () => {
    runner.config = { system: { max_format_errors: 3 } };
    runner.plans = [
      { thought: 'no tool here', finish_reason: 'tool_calls' },
      { thought: 'still no tool', finish_reason: 'tool_calls' },
      { tool: 'bash', args: {}, finish_reason: 'tool_calls' },
      { finish_reason: 'stop', content: 'done' },
    ];
    runner.toolResults = [{ status: 'ok' }];

    const result = await loop.run('test format reset');

    expect(result.status).toBe('completed');
  });

  it('test_uses_default_max_steps', async () => {
    runner.config = {
      system: { max_repeat_calls: 100, max_empty_results: 100 },
    };
    runner.plans = Array.from({ length: 35 }, (_, i) => ({
      tool: 'bash',
      args: { cmd: `echo ${i}` },
      finish_reason: 'tool_calls',
    }));
    runner.toolResults = Array(35).fill({
      status: 'ok',
      output: 'some output',
    });

    const result = await loop.run('long running');

    expect(result.status).toBe('failed');
    expect(result.steps.length).toBe(30);
  });

  it('test_custom_max_steps_parameter', async () => {
    runner.config = {
      system: { max_steps: 100, max_repeat_calls: 100, max_empty_results: 100 },
    };
    runner.plans = Array.from({ length: 10 }, (_, i) => ({
      tool: 'bash',
      args: { cmd: `echo ${i}` },
      finish_reason: 'tool_calls',
    }));
    runner.toolResults = Array(10).fill({
      status: 'ok',
      output: 'some output',
    });

    const result = await loop.run('task', { max_steps: 5 });

    expect(result.status).toBe('failed');
    expect(result.steps.length).toBe(5);
  });

  it('test_records_tool_calls_with_args', async () => {
    runner.plans = [
      {
        tool: 'bash',
        args: { command: 'ls -la' },
        finish_reason: 'tool_calls',
      },
      {
        tool: 'read_file',
        args: { path: 'test.rb' },
        finish_reason: 'tool_calls',
      },
      { finish_reason: 'stop', content: 'done' },
    ];
    runner.toolResults = [{ status: 'ok' }, { status: 'ok' }];

    await loop.run('test recording');

    expect(runner.toolCalls.length).toBe(2);
    expect(runner.toolCalls[0].tool).toBe('bash');
    expect(runner.toolCalls[0].args).toEqual({ command: 'ls -la' });
    expect(runner.toolCalls[1].tool).toBe('read_file');
    expect(runner.toolCalls[1].args).toEqual({ path: 'test.rb' });
  });

  it('test_handles_symbol_and_string_keys', async () => {
    runner.plans = [
      { tool: 'bash', args: { command: 'pwd' }, finish_reason: 'tool_calls' },
      { finish_reason: 'stop', content: 'current directory' },
    ];
    runner.toolResults = [{ status: 'ok', output: '/home/user' }];

    const result = await loop.run('check directory');

    expect(result.status).toBe('completed');
    expect(result.steps.length).toBe(1);
    expect(result.steps[0].tool).toBe('bash');
  });

  it('test_observe_called_after_successful_tool_execution', async () => {
    runner.plans = [
      { tool: 'bash', args: {}, finish_reason: 'tool_calls' },
      { finish_reason: 'stop', content: 'done' },
    ];
    runner.toolResults = [{ status: 'ok' }];

    await loop.run('test observe');

    expect(runner.observeCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('test_handles_context_overflow_error', async () => {
    runner.observe = async () => {
      throw new Error('Context too large');
    };

    runner.plans = [{ finish_reason: 'stop', content: 'handled overflow' }];

    const result = await loop.run('test overflow');

    expect(result.status).toBe('completed');
  });

  it('test_multiple_tools_sequence', async () => {
    runner.plans = [
      {
        tool: 'bash',
        args: { command: 'mkdir test' },
        finish_reason: 'tool_calls',
      },
      {
        tool: 'bash',
        args: { command: 'cd test' },
        finish_reason: 'tool_calls',
      },
      {
        tool: 'bash',
        args: { command: 'touch file.txt' },
        finish_reason: 'tool_calls',
      },
      { finish_reason: 'stop', content: 'Created directory and file' },
    ];
    runner.toolResults = [{ status: 'ok' }, { status: 'ok' }, { status: 'ok' }];

    const result = await loop.run('setup project');

    expect(result.status).toBe('completed');
    expect(result.steps.length).toBe(3);
    expect(result.steps[0].args.command).toBe('mkdir test');
    expect(result.steps[1].args.command).toBe('cd test');
    expect(result.steps[2].args.command).toBe('touch file.txt');
  });

  it('test_handles_blocked_tool_status', async () => {
    runner.plans = [
      { tool: 'bash', args: {}, finish_reason: 'tool_calls' },
      { finish_reason: 'stop', content: 'alternative approach' },
    ];
    runner.toolResults = [
      { status: 'blocked', advice: 'This tool is not allowed' },
    ];

    const result = await loop.run('blocked tool test');

    expect(result.status).toBe('completed');
    const haltedEvents = events.filter((e) => e[0] === 'tool_halted');
    expect(haltedEvents.length).toBe(1);
    expect(haltedEvents[0][1].status).toBe('blocked');
  });

  it('test_handles_upgrade_required_status', async () => {
    runner.plans = [
      { tool: 'bash', args: {}, finish_reason: 'tool_calls' },
      { finish_reason: 'stop', content: 'done' },
    ];
    runner.toolResults = [
      { status: 'upgrade_required', advice: 'Premium feature' },
    ];

    const result = await loop.run('premium test');

    expect(result.status).toBe('completed');
    const haltedEvents = events.filter((e) => e[0] === 'tool_halted');
    expect(haltedEvents.length).toBe(1);
    expect(haltedEvents[0][1].status).toBe('upgrade_required');
  });

  it('test_empty_steps_on_immediate_stop', async () => {
    runner.plans = [
      {
        finish_reason: 'stop',
        content: 'No tools needed',
      },
    ];

    const result = await loop.run('simple question');

    expect(result.status).toBe('completed');
    expect(result.steps).toEqual([]);
    expect(result.final_content).toBe('No tools needed');
  });

  it('test_handles_tool_execution_crash_gracefully', async () => {
    runner.plans = [
      { tool: 'bash', args: {}, finish_reason: 'tool_calls' },
      { finish_reason: 'stop', content: 'recovered' },
    ];
    runner.runCall = async () => {
      throw new Error('Process spawned error');
    };

    const result = await loop.run('crash test');
    expect(result.status).toBe('completed');
    expect(result.steps.length).toBe(1);
    expect(result.steps[0].result.status).toBe('failed');
    expect(result.steps[0].result.error).toBe('Process spawned error');
  });

  it('test_completes_when_llm_returns_no_finish_reason', async () => {
    runner.plans = [
      {
        type: 'text',
        content: 'Task completed successfully without finish_reason!',
        thought: 'Task is complete',
        finish_reason: undefined,
      },
    ];

    const result = await loop.run('do something');

    expect(result.status).toBe('completed');
    expect(result.final_content).toBe(
      'Task completed successfully without finish_reason!',
    );
    expect(result.steps).toEqual([]);
    expect(result.failure_reason).toBeNull();
  });
});

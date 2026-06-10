import { beforeEach, describe, expect, it } from 'vitest';
import { AgentLoop } from '../../src/core/kernel/agentLoop.js';
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
    runner.config = {};
    runner.plans = Array(35).fill({
      tool: 'bash',
      args: {},
      finish_reason: 'tool_calls',
    });
    runner.toolResults = Array(35).fill({ status: 'ok' });

    const result = await loop.run('long running');

    expect(result.status).toBe('failed');
    expect(result.steps.length).toBe(30);
  });

  it('test_custom_max_steps_parameter', async () => {
    runner.config = { system: { max_steps: 100 } };
    runner.plans = Array(10).fill({
      tool: 'bash',
      args: {},
      finish_reason: 'tool_calls',
    });
    runner.toolResults = Array(10).fill({ status: 'ok' });

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
});

import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { Bridge } from '../../src/core/interface/bridge.js';
import {
  AgentLoop,
  type AgentLoopResult,
  type PauseSignal,
} from '../../src/core/kernel/agentLoop.js';
import type { LoopCheckpoint, LoopStep } from '../../src/core/kernel/checkpoint.js';
import type {
  IEventBus,
  PlanEvent,
  PlanResult,
  ToolCall,
  ToolResult,
} from '../../src/core/kernel/interfaces.js';

/**
 * Mirrors Runner.runAgentLoop(): composes an AgentLoop over the resource
 * primitives below and carries completed steps onto a thrown interrupt
 * error. Shared by both mock runners so they exercise Bridge exactly the
 * way the real Runner does.
 */
async function mockRunAgentLoop(
  runner: unknown,
  goal: string,
  options: {
    eventBus?: IEventBus;
    max_steps?: number | null;
    pauseSignal?: PauseSignal | null;
    checkpoint?: LoopCheckpoint | null;
  } = {},
): Promise<AgentLoopResult> {
  const loop = new AgentLoop(runner as never, { eventBus: options.eventBus });
  try {
    return await loop.run(goal, {
      max_steps: options.max_steps,
      pauseSignal: options.pauseSignal,
      checkpoint: options.checkpoint,
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      (err as Error & { completedSteps?: LoopStep[] }).completedSteps =
        loop.completedSteps;
    }
    throw err;
  }
}

class MockRunner {
  public toolCalls: ToolCall[] = [];
  public endedJob: {
    status: 'completed' | 'failed';
    error?: Error | null;
  } | null = null;

  public recordUserInput(_input: string): void {}

  public startJob(_metadata: Record<string, unknown>): void {}

  public endJob(status: 'completed' | 'failed', error?: Error | null): void {
    this.endedJob = { status, error };
  }

  public on(_event: string, _callback: (...args: unknown[]) => void): void {}

  public loadConfig(): Record<string, unknown> {
    return { system: { max_steps: 100 } };
  }

  public async observe(): Promise<string> {
    return 'mock context';
  }

  public async planStream(
    _goal?: string | null,
    _ctx?: unknown,
    _onEvent?: (ev: PlanEvent) => void,
  ): Promise<PlanResult> {
    return {
      type: 'tool_call',
      tool: 'read_file',
      args: { file_path: 'README.md' },
      finish_reason: 'tool_calls',
    } as PlanResult;
  }

  public async runCall(call: ToolCall): Promise<ToolResult> {
    this.toolCalls.push(call);
    return { status: 'ok', output: 'ok' };
  }

  public runAgentLoop(
    goal: string,
    options?: {
      eventBus?: IEventBus;
      max_steps?: number | null;
      pauseSignal?: PauseSignal | null;
      checkpoint?: LoopCheckpoint | null;
    },
  ): Promise<AgentLoopResult> {
    return mockRunAgentLoop(this, goal, options);
  }
}

describe('Bridge', () => {
  it('passes max_steps to the classic agent loop', async () => {
    const runner = new MockRunner();
    const bridge = new Bridge('/tmp/project', { runner: runner as any });

    await bridge.runTurn('keep reading', { auto_mode: true, max_steps: 2 });

    expect(runner.toolCalls).toHaveLength(2);
    expect(runner.endedJob?.status).toBe('failed');
    expect(runner.endedJob?.error?.message).toContain(
      'Max execution steps reached (2)',
    );
  });

  it('does not emit on_thought for text already streamed live via on_token', async () => {
    const runner = new MockRunner();
    runner.planStream = async (_goal, _ctx, onEvent) => {
      onEvent?.({ type: 'delta', text: 'reading the file' });
      return {
        type: 'tool_call',
        tool: 'read_file',
        args: { file_path: 'README.md' },
        thought: 'reading the file',
        finish_reason: 'tool_calls',
      } as PlanResult;
    };
    const bridge = new Bridge('/tmp/project', { runner: runner as any });

    const thoughts: string[] = [];
    bridge.on('on_thought', (content: string) => {
      thoughts.push(content);
    });

    await bridge.runTurn('read a file', { auto_mode: true, max_steps: 1 });

    expect(thoughts).toHaveLength(0);
  });

  it('emits on_thought when the plan text was not streamed live', async () => {
    const runner = new MockRunner();
    runner.planStream = async () =>
      ({
        type: 'tool_call',
        tool: 'read_file',
        args: { file_path: 'README.md' },
        thought: 'thinking without streaming',
        finish_reason: 'tool_calls',
      }) as PlanResult;
    const bridge = new Bridge('/tmp/project', { runner: runner as any });

    const thoughts: string[] = [];
    bridge.on('on_thought', (content: string) => {
      thoughts.push(content);
    });

    await bridge.runTurn('read a file', { auto_mode: true, max_steps: 1 });

    expect(thoughts).toContain('thinking without streaming');
  });

  it('does not double-fire tool UI events when the runner also emits them directly', async () => {
    // Regression test: the real Runner.runCall() emits tool_start/
    // tool_executing/tool_result on itself (an EventEmitter) in addition to
    // AgentLoop emitting the identical events on the eventBus Bridge wires
    // up in runTurn(). Bridge used to subscribe to both sources for these
    // three events, so a single tool call rendered twice in the CLI. The
    // plain MockRunner above never actually emits real events (its `on` is
    // a no-op stub), so it can't catch this — this runner mirrors Runner by
    // extending EventEmitter and emitting for real.
    class EmittingMockRunner extends EventEmitter {
      public toolCalls: ToolCall[] = [];
      public endedJob: { status: string; error?: Error | null } | null = null;

      public recordUserInput(_input: string): void {}
      public startJob(_metadata: Record<string, unknown>): void {}
      public endJob(status: 'completed' | 'failed', error?: Error | null): void {
        this.endedJob = { status, error };
      }
      public loadConfig(): Record<string, unknown> {
        return { system: { max_steps: 1 } };
      }
      public async observe(): Promise<string> {
        return 'mock context';
      }
      public async planStream(): Promise<PlanResult> {
        return {
          type: 'tool_call',
          tool: 'read_file',
          args: { file_path: 'README.md' },
          finish_reason: 'tool_calls',
        } as PlanResult;
      }
      public async runCall(call: ToolCall): Promise<ToolResult> {
        this.toolCalls.push(call);
        this.emit('tool_start', {
          tool: call.tool,
          args: call.args,
          summary: call.summary,
        });
        this.emit('tool_executing', { tool: call.tool });
        const result: ToolResult = { status: 'ok', output: 'done' };
        this.emit('tool_result', { tool: call.tool, result });
        return result;
      }
      public runAgentLoop(
        goal: string,
        options?: {
          eventBus?: IEventBus;
          max_steps?: number | null;
          pauseSignal?: PauseSignal | null;
          checkpoint?: LoopCheckpoint | null;
        },
      ): Promise<AgentLoopResult> {
        return mockRunAgentLoop(this, goal, options);
      }
    }

    const runner = new EmittingMockRunner();
    const bridge = new Bridge('/tmp/project', { runner: runner as any });

    const starts: unknown[] = [];
    const executing: unknown[] = [];
    const results: unknown[] = [];
    bridge.on('on_tool_start', (...args: unknown[]) => starts.push(args));
    bridge.on('on_tool_executing', (...args: unknown[]) => executing.push(args));
    bridge.on('on_tool_result', (...args: unknown[]) => results.push(args));

    await bridge.runTurn('read a file', { auto_mode: true, max_steps: 1 });

    expect(starts).toHaveLength(1);
    expect(executing).toHaveLength(1);
    expect(results).toHaveLength(1);
  });
});

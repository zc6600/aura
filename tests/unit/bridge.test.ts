import { describe, expect, it } from 'vitest';
import { Bridge } from '../../src/core/interface/bridge.js';
import type {
  PlanEvent,
  PlanResult,
  ToolCall,
  ToolResult,
} from '../../src/core/kernel/interfaces.js';

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
}

describe('Bridge', () => {
  it('passes max_steps to the classic agent loop', async () => {
    const runner = new MockRunner();
    const bridge = new Bridge('/tmp/project', { runner: runner as any });

    await bridge.chat('keep reading', { auto_mode: true, max_steps: 2 });

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

    await bridge.chat('read a file', { auto_mode: true, max_steps: 1 });

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

    await bridge.chat('read a file', { auto_mode: true, max_steps: 1 });

    expect(thoughts).toContain('thinking without streaming');
  });
});

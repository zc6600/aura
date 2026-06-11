import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { Hooks } from '../../src/core/kernel/hooks.js';
import { RalphLoop, RalphPayload } from '../../src/core/kernel/ralphLoop.js';
import type { CompletionResult } from '../../src/core/llm/adapters/base.js';
import { ResponseParser } from '../../src/core/llm/parsers/responseParser.js';
import type {
  ChatMessage,
  CompletionOptions,
} from '../../src/core/llm/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface MockLLMCall {
  method: 'complete' | 'completeStream';
  messages: ChatMessage[];
  options: CompletionOptions;
}

class MockLLMClient {
  public responses: any[] = [];
  public calls: MockLLMCall[] = [];
  public responseIndex = 0;

  public async complete(
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): Promise<CompletionResult> {
    this.calls.push({ method: 'complete', messages, options });
    const response =
      this.responses[this.responseIndex] ||
      this.responses[this.responses.length - 1];
    this.responseIndex++;
    return (
      (response as CompletionResult) || {
        content: '',
        raw: null,
        finish_reason: 'stop',
      }
    );
  }

  public async completeStream(
    messages: ChatMessage[],
    options: CompletionOptions = {},
    onChunk?: (chunk: string) => void,
  ): Promise<CompletionResult> {
    this.calls.push({ method: 'completeStream', messages, options });
    const response =
      this.responses[this.responseIndex] ||
      this.responses[this.responses.length - 1];
    this.responseIndex++;
    if (response && onChunk) {
      onChunk(response.content || '');
    }
    return {
      content: response?.content || '',
      raw: null,
      finish_reason: response?.finish_reason || 'stop',
    };
  }
}

class MockRunner {
  public projectPath: string;
  public envPath: string;
  public planner: { client: MockLLMClient };
  public hooks = new Hooks();
  public config: Record<string, unknown> = {};
  public planCalls: { goal: string; ctx: string }[] = [];
  public toolCalls: ResponseParser[] = [];
  public observeCalls: boolean[] = [];
  public sessionConnected: string | null = null;
  public memory: {
    store: { db: any; dbPath?: string; close?(): void };
    recorder: { recordCustom(phase: string, payload: unknown): void };
    metabolizeIfNeeded?(): Promise<void>;
  } = {
    store: { db: null as unknown as import('better-sqlite3').Database },
    recorder: { recordCustom: () => {} },
    metabolizeIfNeeded: async () => {},
  };

  constructor(client: MockLLMClient, projectPath: string) {
    this.projectPath = projectPath;
    this.envPath = path.join(projectPath, '.aura-workspace');
    this.planner = { client };
    this.config = {
      ralph: {
        max_steps: 10,
        verify_command: 'echo test',
        use_critic: false,
      },
      llm: {
        provider: 'local',
      },
    };
  }

  public reconnectSession(sessionName: string): void {
    this.sessionConnected = sessionName;
    const dbDir = path.join(this.envPath, 'state', 'sessions');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    fs.writeFileSync(path.join(dbDir, `${sessionName}.db`), 'mock_sqlite_data');
    fs.writeFileSync(
      path.join(dbDir, `${sessionName}.db-journal`),
      'mock_sqlite_journal',
    );
  }

  public async planStream(
    goal: string,
    ctx: string,
    onEvent?: (ev: { type: string; text: string }) => void,
  ): Promise<ResponseParser> {
    this.planCalls.push({ goal, ctx });
    const res = await this.planner.client.complete([], {});
    const parsed = ResponseParser.parse(res.raw || res.content);
    parsed.finish_reason = res.finish_reason;
    if (onEvent) {
      onEvent({ type: 'delta', text: res.content as string });
    }
    return parsed;
  }

  public async runCall(call: ResponseParser): Promise<{
    status: string;
    output: string;
  }> {
    this.toolCalls.push(call);
    return { status: 'ok', output: 'mock tool run ok' };
  }

  public async observe(): Promise<RalphPayload> {
    this.observeCalls.push(true);
    return new RalphPayload([
      { role: 'user', content: 'mock_workspace_state' },
    ]);
  }

  public loadConfig(): Record<string, unknown> {
    return this.config;
  }
}

describe('RalphLoop', () => {
  const tempDir = path.resolve(__dirname, 'temp-ralph-test');
  const envPath = path.join(tempDir, '.aura-workspace');
  let mockClient: MockLLMClient;
  let mockRunner: any;

  beforeAll(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    if (fs.existsSync(envPath)) {
      fs.rmSync(envPath, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(envPath, 'config'), { recursive: true });

    // Write a base config.yml
    const baseConfig = {
      ralph: {
        max_steps: 10,
        verify_command: 'echo test',
        use_critic: false,
      },
      llm: {
        provider: 'local',
      },
    };
    fs.writeFileSync(
      path.join(envPath, 'config', 'config.yml'),
      yaml.stringify(baseConfig),
    );

    mockClient = new MockLLMClient();
    mockRunner = new MockRunner(mockClient, tempDir);
  });

  it('test_physical_verify_passes_immediately', async () => {
    mockClient.responses = [
      {
        content: 'Task completed successfully summarizing all modifications.',
        finish_reason: 'stop',
      },
    ];

    const loopInst = new RalphLoop(mockRunner, 'fix bug');
    const result = await loopInst.run();

    expect(result).toBe('completed');
  });

  it('test_physical_verify_fails_once_then_succeeds', async () => {
    // We mock the verify_command to exit with 1 twice, then 0.
    const counterFile = path.join(tempDir, 'counter.txt');
    fs.writeFileSync(counterFile, '0');
    const verifyCommand = `node -e "const fs = require('fs'); const c = parseInt(fs.readFileSync('${counterFile.replace(/\\/g, '\\\\')}', 'utf-8')); fs.writeFileSync('${counterFile.replace(/\\/g, '\\\\')}', String(c+1)); process.exit(c >= 2 ? 0 : 1)"`;

    mockRunner.config.ralph.verify_command = verifyCommand;

    mockClient.responses = [
      { content: 'First attempt at fixing', finish_reason: 'stop' },
      { content: 'Second attempt with verified result', finish_reason: 'stop' },
    ];

    const loopInst = new RalphLoop(mockRunner, 'fix bug');
    const result = await loopInst.run();

    expect(result).toBe('completed');
    expect(mockClient.responseIndex).toBe(3);
  });

  it('test_critic_rejects_first_then_accepts', async () => {
    mockClient.responses = [
      {
        raw: '{"tool": "read_file", "args": {"path": "a.txt"}, "summary": "reading"}',
        finish_reason: 'tool_calls',
      },
      {
        raw: '{"completed": false, "critique": "not fixed yet", "advice": "edit file"}',
        finish_reason: 'stop',
      },
      { raw: 'fixed content', finish_reason: 'stop' },
      {
        raw: '{"completed": true, "critique": "perfect", "advice": ""}',
        finish_reason: 'stop',
      },
    ];

    const loopInst = new RalphLoop(mockRunner, 'fix code', { critic: true });
    const result = await loopInst.run();

    expect(result).toBe('completed');

    const runId = loopInst.getRunId();
    const auditFile = path.join(
      envPath,
      'state',
      `critic_audit_${runId}_step_2.md`,
    );
    expect(fs.existsSync(auditFile)).toBe(true);
    const auditContent = fs.readFileSync(auditFile, 'utf-8');
    expect(auditContent).toContain('PASSING');
    expect(auditContent).toContain('perfect');
  });

  it('test_critic_mode_heavy_runs_agent_loop', async () => {
    mockClient.responses = [
      {
        raw: '{"tool": "read_file", "args": {"path": "a.txt"}, "summary": "reading"}',
        finish_reason: 'tool_calls',
      },
      {
        raw: '{"completed": false, "critique": "not fixed yet", "advice": "edit file"}',
        finish_reason: 'stop',
      },
      {
        raw: '{"tool": "read_file", "args": {"path": "b.txt"}, "summary": "reading critique"}',
        finish_reason: 'tool_calls',
      },
      {
        raw: '{"completed": true, "critique": "perfect now", "advice": ""}',
        finish_reason: 'stop',
      },
    ];

    const loopInst = new RalphLoop(mockRunner, 'fix code', {
      critic: true,
      critic_mode: 'heavy',
    });
    const result = await loopInst.run();

    expect(result).toBe('completed');
  });

  it('test_aborts_on_max_steps', async () => {
    mockClient.responses = Array(10).fill({
      raw: '{"tool": "read_file", "args": {"path": "a.txt"}, "summary": "looping"}',
      finish_reason: 'tool_calls',
    });

    const loopInst = new RalphLoop(mockRunner, 'endless goal', {
      max_steps: 3,
    });
    const result = await loopInst.run();

    expect(result).toBe('failed');
  });

  it('test_hook_cleanup_and_mode_transitions', async () => {
    mockClient.responses = [
      { content: 'Finished goal', finish_reason: 'stop' },
    ];

    const loopInst = new RalphLoop(mockRunner, 'fix bug');

    const hooksBefore = (mockRunner.hooks as any).hookMap.before_planning;
    expect(hooksBefore).toContain(loopInst.getPlanningHookProc());

    const result = await loopInst.run();
    expect(result).toBe('completed');

    const hooksAfter = (mockRunner.hooks as any).hookMap.before_planning;
    expect(hooksAfter).not.toContain(loopInst.getPlanningHookProc());
    expect(loopInst.getCurrentMode()).toBe('developer');
  });

  it('test_verification_command_timeout', async () => {
    mockClient.responses = [{ content: 'Finished', finish_reason: 'stop' }];

    // Configure verify_command to a command that takes 500ms
    mockRunner.config.ralph.verify_command = `node -e "setTimeout(() => {}, 500)"`;

    // Timeout of 0.05 seconds (50ms)
    const loopInst = new RalphLoop(mockRunner, 'fix bug', {
      max_steps: 1,
      timeout: 0.05,
    });
    const result = await loopInst.run();

    expect(result).toBe('failed');
    expect(loopInst.getLastTestFeedback()).toContain('timed out after');
  });

  it('test_session_db_cleanup', async () => {
    mockClient.responses = [{ content: 'Finished', finish_reason: 'stop' }];

    const loopInst = new RalphLoop(mockRunner, 'fix bug', { max_steps: 2 });
    await loopInst.run();

    const dbDir = path.join(envPath, 'state', 'sessions');
    const tempDbs = fs
      .readdirSync(dbDir)
      .filter((f) => f.startsWith('ralph_run_'));
    expect(tempDbs).toEqual([]);
  });

  it('test_concurrent_loop_audit_isolation', async () => {
    const loopInst1 = new RalphLoop(mockRunner, 'run 1');
    const loopInst2 = new RalphLoop(mockRunner, 'run 2');

    loopInst1.setRunId('RUN1_HEX');
    loopInst2.setRunId('RUN2_HEX');
    loopInst1.setIterationCount(1);
    loopInst2.setIterationCount(1);

    await (loopInst1 as any).writeCriticAuditFile(
      'critique 1',
      'advice 1',
      false,
    );
    await (loopInst2 as any).writeCriticAuditFile(
      'critique 2',
      'advice 2',
      false,
    );

    const file1 = path.join(
      envPath,
      'state',
      'critic_audit_RUN1_HEX_step_1.md',
    );
    const file2 = path.join(
      envPath,
      'state',
      'critic_audit_RUN2_HEX_step_1.md',
    );

    expect(fs.existsSync(file1)).toBe(true);
    expect(fs.existsSync(file2)).toBe(true);
    expect(fs.readFileSync(file1, 'utf-8')).toContain('critique 1');
    expect(fs.readFileSync(file2, 'utf-8')).toContain('critique 2');
  });

  it('test_loop_resilience_to_developer_loop_exceptions', async () => {
    mockClient.responses = [{ content: 'Attempt 2', finish_reason: 'stop' }];

    let callCount = 0;
    mockRunner.planStream = async (
      _goal: string,
      _ctx: string,
      onEvent?: (ev: { type: string; text: string }) => void,
    ) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Transient LLM error');
      } else {
        const res = await mockClient.complete([], {});
        const parsed = ResponseParser.parse(res.raw || res.content);
        parsed.finish_reason = res.finish_reason;
        if (onEvent) {
          onEvent({ type: 'delta', text: res.content as string });
        }
        return parsed;
      }
    };

    const loopInst = new RalphLoop(mockRunner, 'fix bug', { max_steps: 2 });
    const result = await loopInst.run();

    expect(result).toBe('completed');
    expect(callCount).toBe(2);
  });
});

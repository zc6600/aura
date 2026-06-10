import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import yaml from 'yaml';
import type { PlanEvent } from '../../src/core/kernel/interfaces.js';
import { Planner } from '../../src/core/kernel/planner.js';
import type { CompletionResult } from '../../src/core/llm/adapters/base.js';
import type {
  ChatMessage,
  CompletionOptions,
} from '../../src/core/llm/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface MockCall {
  method: 'complete' | 'completeStream';
  messages: ChatMessage[];
  options: CompletionOptions;
}

class MockLLMClient {
  public responses: any[] = [];
  public streamResponses: any[][] = [];
  public calls: MockCall[] = [];
  private responseIndex = 0;
  private streamIndex = 0;

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
    const streamData =
      this.streamResponses[this.streamIndex] ||
      this.streamResponses[this.streamResponses.length - 1];
    this.streamIndex++;

    if (streamData && onChunk) {
      for (const chunk of streamData) {
        onChunk(chunk.content || '');
      }
    }

    const finalContent = streamData
      ? streamData.map((c) => c.content || '').join('')
      : '';
    const finalReason =
      streamData && streamData.length > 0
        ? streamData[streamData.length - 1].finish_reason
        : 'stop';
    return { content: finalContent, raw: null, finish_reason: finalReason };
  }
}

describe('Planner', () => {
  const tempDir = path.resolve(__dirname, 'temp-planner-test');
  const envPath = path.join(tempDir, '.aura');
  const configDir = path.join(envPath, 'config');
  let mockClient: MockLLMClient;

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
    fs.mkdirSync(configDir, { recursive: true });

    const config = {
      llm: {
        provider: 'openai',
        model: 'gpt-4',
        temperature: 0.7,
        max_tokens: 1000,
      },
      tool_protocol: {
        call_summary: {
          suggested_chars: 100,
          max_chars: 200,
        },
      },
    };
    fs.writeFileSync(
      path.join(configDir, 'config.yml'),
      yaml.stringify(config),
    );

    process.env.OPENAI_API_KEY = 'sk-test-key-12345';
    mockClient = new MockLLMClient();
  });

  const createPlanner = () => {
    const planner = new Planner(tempDir, { envPath });
    (planner as any).client = mockClient;
    return planner;
  };

  it('test_plan_returns_parsed_response', async () => {
    mockClient.responses = [
      {
        raw: '{"tool": "bash", "args": {"command": "ls"}}',
        finish_reason: 'tool_calls',
      },
    ];

    const planner = createPlanner();
    const result = (await planner.plan('List files', 'Current context')) as any;

    expect(result.type).toBe('tool_call');
    expect(result.tool).toBe('bash');
    expect(result.args).toEqual({ command: 'ls' });
    expect(result.finish_reason).toBe('tool_calls');
  });

  it('test_plan_with_stop_finish', async () => {
    mockClient.responses = [
      {
        raw: '{"content": "Task completed"}',
        finish_reason: 'stop',
      },
    ];

    const planner = createPlanner();
    const result = (await planner.plan('Simple question')) as any;

    expect(result.finish_reason).toBe('stop');
    expect(result.content).toBe('Task completed');
  });

  it('test_plan_passes_context_and_goal', async () => {
    mockClient.responses = [
      {
        raw: '{"content": "response"}',
        finish_reason: 'stop',
      },
    ];

    const planner = createPlanner();
    await planner.plan('My goal', 'Context with details');

    expect(mockClient.calls.length).toBe(1);
    const call = mockClient.calls[0];
    expect(call.method).toBe('complete');
    const messages = call.messages;
    expect(
      messages.some((m: ChatMessage) => m.content.includes('My goal')),
    ).toBe(true);
  });

  it('test_plan_uses_configured_temperature_and_max_tokens', async () => {
    mockClient.responses = [
      {
        raw: '{"content": "ok"}',
        finish_reason: 'stop',
      },
    ];

    const planner = createPlanner();
    await planner.plan('test');

    const call = mockClient.calls[0];
    expect(call.options.temperature).toBe(0.7);
    expect(call.options.max_tokens).toBe(1000);
  });

  it('test_plan_stream_yields_delta_events', async () => {
    const deltas: PlanEvent[] = [];
    mockClient.streamResponses = [
      [
        { content: '{"tool":', finish_reason: null },
        { content: ' "bash"', finish_reason: null },
        { content: ', "args": {}}', finish_reason: 'tool_calls' },
      ],
    ];

    const planner = createPlanner();
    await planner.planStream('context', 'test goal', (event) => {
      deltas.push(event);
    });

    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas[0].type).toBe('delta');
  });

  it('test_plan_stream_returns_tool_call_plan', async () => {
    mockClient.streamResponses = [
      [
        {
          content: '{"tool": "bash", "args": {}}',
          finish_reason: 'tool_calls',
        },
      ],
    ];

    const planner = createPlanner();
    const result = (await planner.planStream('context', 'test')) as any;

    expect(result.type).toBe('tool_call');
    expect(result.tool).toBe('bash');
  });

  it('test_plan_stream_yields_plan_event', async () => {
    const planEvents: PlanEvent[] = [];
    mockClient.streamResponses = [
      [
        {
          content: '{"tool": "read_file", "args": {"path": "test.rb"}}',
          finish_reason: 'tool_calls',
        },
      ],
    ];

    const planner = createPlanner();
    await planner.planStream('context', 'test', (event) => {
      if (event.type === 'plan') {
        planEvents.push(event);
      }
    });

    expect(planEvents.length).toBe(1);
    expect(planEvents[0].type).toBe('plan');
    expect((planEvents[0] as any).plan.tool).toBe('read_file');
  });

  it('test_plan_stream_with_text_response', async () => {
    mockClient.streamResponses = [
      [{ content: '{"content": "Final answer"}', finish_reason: 'stop' }],
    ];

    const planner = createPlanner();
    const result = (await planner.planStream('context', 'question')) as any;

    expect(result.finish_reason).toBe('stop');
    expect(result.type).toBe('text');
    expect(result.content).toContain('Final answer');
  });

  it('test_load_config_from_config_yml', async () => {
    mockClient.responses = [
      {
        raw: '{"content": "ok"}',
        finish_reason: 'stop',
      },
    ];

    const planner = createPlanner();
    await planner.plan('test');

    const call = mockClient.calls[0];
    expect(call.options.temperature).toBe(0.7);
  });

  it('test_default_config_when_config_missing', async () => {
    fs.rmSync(configDir, { recursive: true, force: true });

    mockClient.responses = [
      {
        raw: '{"content": "ok"}',
        finish_reason: 'stop',
      },
    ];

    const planner = createPlanner();
    await planner.plan('test');

    const call = mockClient.calls[0];
    expect(call.options.temperature).toBeUndefined();
  });

  it('test_provider_resolution_from_config', async () => {
    const config = {
      llm: {
        provider: 'anthropic',
      },
    };
    fs.writeFileSync(
      path.join(configDir, 'config.yml'),
      yaml.stringify(config),
    );

    mockClient.responses = [
      {
        raw: '{"tool": "test", "args": {}}',
        finish_reason: 'stop',
      },
    ];

    const planner = createPlanner();
    const result = (await planner.plan('test')) as any;
    expect(result.tool).toBe('test');
  });

  it('test_empty_response_handled_gracefully', async () => {
    mockClient.responses = [
      {
        raw: '',
        finish_reason: 'stop',
      },
    ];

    const planner = createPlanner();
    const result = (await planner.plan('test')) as any;

    expect(result).toBeTypeOf('object');
    expect(result.type).toBe('text');
  });

  it('test_malformed_json_response', async () => {
    mockClient.responses = [
      {
        raw: 'not valid json {{{',
        finish_reason: 'stop',
      },
    ];

    const planner = createPlanner();
    const result = (await planner.plan('test')) as any;

    expect(result).toBeTypeOf('object');
    expect(result.type).toBe('text');
  });

  it('test_plan_with_nil_goal', async () => {
    mockClient.responses = [
      {
        raw: '{"content": "response"}',
        finish_reason: 'stop',
      },
    ];

    const planner = createPlanner();
    const result = await planner.plan('context only', null);

    expect(result.finish_reason).toBe('stop');
  });

  it('test_plan_with_empty_context', async () => {
    mockClient.responses = [
      {
        raw: '{"content": "ok"}',
        finish_reason: 'stop',
      },
    ];

    const planner = createPlanner();
    const result = (await planner.plan('', 'goal')) as any;

    expect(result.type).toBe('text');
    expect(result.content).toContain('ok');
  });

  it('test_multiple_sequential_plans', async () => {
    mockClient.responses = [
      { raw: '{"tool": "tool1", "args": {}}', finish_reason: 'tool_calls' },
      { raw: '{"tool": "tool2", "args": {}}', finish_reason: 'tool_calls' },
      { raw: '{"content": "done"}', finish_reason: 'stop' },
    ];

    const planner = createPlanner();
    const result1 = (await planner.plan('step 1')) as any;
    const result2 = (await planner.plan('step 2')) as any;
    const result3 = (await planner.plan('step 3')) as any;

    expect(result1.tool).toBe('tool1');
    expect(result2.tool).toBe('tool2');
    expect(result3.type).toBe('text');
    expect(result3.content).toContain('done');
  });

  it('test_finish_reason_propagated', async () => {
    const reasons = ['stop', 'tool_calls', 'length', 'content_filter', 'error'];
    for (const reason of reasons) {
      mockClient.responses = [
        {
          raw: '{"tool": "test", "args": {}}',
          finish_reason: reason,
        },
      ];

      const planner = createPlanner();
      const result = (await planner.plan('test')) as any;
      expect(result.finish_reason).toBe(reason);
    }
  });

  it('test_plan_stream_with_empty_stream', async () => {
    mockClient.streamResponses = [[]];

    const planner = createPlanner();
    const result = (await planner.planStream('test', null)) as any;

    expect(result).toBeTypeOf('object');
  });

  it('test_plan_includes_tools_if_available', async () => {
    mockClient.responses = [
      {
        raw: '{"content": "ok"}',
        finish_reason: 'stop',
      },
    ];

    const planner = createPlanner();
    const mockContext = {
      toMessages: () => [{ role: 'user' as const, content: 'test' }],
      toToolSchemas: () => [
        {
          name: 'dummy_tool',
          description: 'dummy description',
          input_schema: {},
        },
      ],
    };
    await planner.plan(mockContext);

    const call = mockClient.calls[0];
    expect(call.options).toHaveProperty('tools');
  });

  it('test_config_error_tolerance', async () => {
    fs.writeFileSync(path.join(configDir, 'config.yml'), 'invalid: yaml: {{{');

    mockClient.responses = [
      {
        raw: '{"content": "ok"}',
        finish_reason: 'stop',
      },
    ];

    const planner = createPlanner();
    const result = await planner.plan('test');

    expect(result).toBeTypeOf('object');
  });
});

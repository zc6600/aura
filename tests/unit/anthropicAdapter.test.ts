import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicAdapter } from '../../src/core/llm/adapters/anthropic.js';
import { Client } from '../../src/core/llm/client.js';
import { HttpClient } from '../../src/core/llm/httpClient.js';
import type { ChatMessage } from '../../src/core/llm/types.js';

interface StreamOptions {
  stream?: boolean;
  onChunk?: (chunk: string) => void;
}

vi.mock('../../src/core/llm/httpClient.js', () => {
  return {
    HttpClient: {
      post: vi.fn(),
    },
  };
});

describe('AnthropicAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_anthropic_adapter_default_endpoint_and_routing', () => {
    const client = new Client({ provider: 'anthropic', apiKey: 'ant-key' });
    const underlying = (client as any).adapter;
    expect(underlying).toBeInstanceOf(AnthropicAdapter);
  });

  it('test_anthropic_complete_request_and_response', async () => {
    const adapter = new AnthropicAdapter({ apiKey: 'ant-key' });

    const fakeResponse = {
      content: [{ type: 'text', text: 'CLAUDE_REPLY' }],
      stop_reason: 'end_turn',
    };

    vi.mocked(HttpClient.post).mockResolvedValue(fakeResponse);

    const messages: ChatMessage[] = [
      { role: 'system', content: 'SYS_RULE' },
      { role: 'user', content: 'hello' },
    ];
    const out = await adapter.complete(messages, { temperature: 0.5 });

    expect(HttpClient.post).toHaveBeenCalledTimes(1);
    const [url, headers, body] = vi.mocked(HttpClient.post).mock.calls[0];

    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(headers).toEqual({
      'x-api-key': 'ant-key',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    });
    expect(body.model).toBe('claude-3-5-haiku-20241022');
    expect(body.temperature).toBe(0.5);
    expect(body.system).toBe('SYS_RULE');
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);

    expect(out.content).toBe('CLAUDE_REPLY');
    expect(out.finish_reason).toBe('end_turn');
  });

  it('test_anthropic_stream_yields_tokens', async () => {
    const adapter = new AnthropicAdapter({ apiKey: 'ant-key' });

    vi.mocked(HttpClient.post).mockImplementation(
      (_url, _headers, _body, opts?: StreamOptions) => {
        if (opts?.stream && opts?.onChunk) {
          opts.onChunk(
            'data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "X"}}\n',
          );
          opts.onChunk(
            'data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Y"}}\n',
          );
          opts.onChunk(
            `data: {"type": "message_delta", "delta": {"stop_reason": "end_turn"}}
`,
          );
        }
        return Promise.resolve(null);
      },
    );

    const tokens: string[] = [];
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }];
    const out = await adapter.completeStream(messages, {}, (tok) => {
      tokens.push(tok);
    });

    expect(tokens).toEqual(['X', 'Y']);
    expect(out.content).toBe('XY');
    expect(out.finish_reason).toBe('end_turn');
  });

  it('sends native tool schemas and parses a tool_use response', async () => {
    const adapter = new AnthropicAdapter({ apiKey: 'ant-key' });

    const fakeResponse = {
      content: [
        { type: 'text', text: 'Checking the weather.' },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'get_weather',
          input: { city: 'SF' },
        },
      ],
      stop_reason: 'tool_use',
    };
    vi.mocked(HttpClient.post).mockResolvedValue(fakeResponse);

    const messages: ChatMessage[] = [{ role: 'user', content: 'weather?' }];
    const out = await adapter.complete(messages, {
      tools: [
        {
          name: 'get_weather',
          description: 'Get the weather for a city.',
          input_schema: {
            type: 'object',
            properties: { city: { type: 'string' } },
          },
        },
      ],
    });

    const [, , body] = vi.mocked(HttpClient.post).mock.calls[0];
    expect(body.tools).toEqual([
      {
        name: 'get_weather',
        description: 'Get the weather for a city.',
        input_schema: {
          type: 'object',
          properties: { city: { type: 'string' } },
        },
      },
    ]);
    expect(body.tool_choice).toEqual({ type: 'auto' });

    expect(out.content).toBe('Checking the weather.');
    expect(out.finish_reason).toBe('tool_use');
    expect(out.raw).toEqual({
      tool_calls: [{ id: 'toolu_1', name: 'get_weather', input: { city: 'SF' } }],
      content: 'Checking the weather.',
    });
  });

  it('omits tools from the request when none are provided', async () => {
    const adapter = new AnthropicAdapter({ apiKey: 'ant-key' });
    vi.mocked(HttpClient.post).mockResolvedValue({
      content: [{ type: 'text', text: 'hi' }],
      stop_reason: 'end_turn',
    });

    await adapter.complete([{ role: 'user', content: 'hi' }], {});

    const [, , body] = vi.mocked(HttpClient.post).mock.calls[0];
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it('streams a tool_use block via input_json_delta and reconstructs its input', async () => {
    const adapter = new AnthropicAdapter({ apiKey: 'ant-key' });

    vi.mocked(HttpClient.post).mockImplementation(
      (_url, _headers, _body, opts?: StreamOptions) => {
        if (opts?.stream && opts?.onChunk) {
          opts.onChunk(
            'data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text"}}\n',
          );
          opts.onChunk(
            'data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Sure."}}\n',
          );
          opts.onChunk(
            'data: {"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "toolu_2", "name": "get_weather"}}\n',
          );
          opts.onChunk(
            'data: {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\\"city\\":"}}\n',
          );
          opts.onChunk(
            'data: {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "\\"SF\\"}"}}\n',
          );
          opts.onChunk(
            'data: {"type": "message_delta", "delta": {"stop_reason": "tool_use"}}\n',
          );
        }
        return Promise.resolve(null);
      },
    );

    const tokens: string[] = [];
    const out = await adapter.completeStream(
      [{ role: 'user', content: 'weather?' }],
      {
        tools: [
          {
            name: 'get_weather',
            description: 'Get the weather for a city.',
            input_schema: { type: 'object', properties: {} },
          },
        ],
      },
      (tok) => tokens.push(tok),
    );

    expect(tokens).toEqual(['Sure.']);
    expect(out.content).toBe('Sure.');
    expect(out.finish_reason).toBe('tool_use');
    expect(out.raw).toEqual({
      tool_calls: [{ id: 'toolu_2', name: 'get_weather', input: { city: 'SF' } }],
      content: 'Sure.',
    });
  });
});

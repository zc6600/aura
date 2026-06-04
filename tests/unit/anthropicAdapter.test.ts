import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicAdapter } from '../../src/core/llm/adapters/anthropic.js';
import { Client } from '../../src/core/llm/client.js';
import { HttpClient } from '../../src/core/llm/httpClient.js';

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
    const adapter = new AnthropicAdapter({ apiKey: 'ant-key' });
    expect((adapter as any).apiBase).toBe('https://api.anthropic.com/v1/messages');
    expect((adapter as any).model).toBe('claude-3-5-sonnet-20241022');

    const client = new Client({ provider: 'anthropic', apiKey: 'ant-key' });
    const underlying = (client as any).adapter;
    expect(underlying).toBeInstanceOf(AnthropicAdapter);
  });

  it('test_anthropic_complete_request_and_response', async () => {
    const adapter = new AnthropicAdapter({ apiKey: 'ant-key' });

    const fakeResponse = {
      content: [
        { type: 'text', text: 'CLAUDE_REPLY' },
      ],
      stop_reason: 'end_turn',
    };

    vi.mocked(HttpClient.post).mockResolvedValue(fakeResponse);

    const messages = [
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
    expect(body.model).toBe('claude-3-5-sonnet-20241022');
    expect(body.temperature).toBe(0.5);
    expect(body.system).toBe('SYS_RULE');
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);

    expect(out.content).toBe('CLAUDE_REPLY');
    expect(out.finish_reason).toBe('end_turn');
  });

  it('test_anthropic_stream_yields_tokens', async () => {
    const adapter = new AnthropicAdapter({ apiKey: 'ant-key' });

    vi.mocked(HttpClient.post).mockImplementation((url, headers, body, opts: any) => {
      if (opts.stream && opts.onChunk) {
        opts.onChunk('data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "X"}}\n');
        opts.onChunk('data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Y"}}\n');
        opts.onChunk('data: {"type": "message_delta", "delta": {"stop_reason": "end_turn"}}\n');
      }
      return Promise.resolve(null);
    });

    const tokens: string[] = [];
    const messages = [{ role: 'user', content: 'hello' }];
    const out = await adapter.completeStream(messages, {}, (tok) => {
      tokens.push(tok);
    });

    expect(tokens).toEqual(['X', 'Y']);
    expect(out.content).toBe('XY');
    expect(out.finish_reason).toBe('end_turn');
  });
});

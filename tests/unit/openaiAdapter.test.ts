import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIAdapter } from '../../src/core/llm/adapters/openai.js';
import { Client } from '../../src/core/llm/client.js';
import { HttpClient } from '../../src/core/llm/httpClient.js';

vi.mock('../../src/core/llm/httpClient.js', () => {
  return {
    HttpClient: {
      post: vi.fn(),
    },
  };
});

describe('OpenAIAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_openai_adapter_default_endpoint_and_routing', () => {
    const client = new Client({ provider: 'openai', apiKey: 'oa-key' });
    const underlying = client.getAdapter();
    expect(underlying).toBeInstanceOf(OpenAIAdapter);
  });

  it('test_openai_complete_request_and_response', async () => {
    const adapter = new OpenAIAdapter({ apiKey: 'oa-key', model: 'gpt-4o' });

    const fakeResponse = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'OPENAI_REPLY',
          },
          finish_reason: 'stop',
        },
      ],
    };

    vi.mocked(HttpClient.post).mockResolvedValue(fakeResponse);

    const messages = [{ role: 'user' as const, content: 'hello' }];
    const out = await adapter.complete(messages, { temperature: 0.5 });

    expect(HttpClient.post).toHaveBeenCalledTimes(1);
    const [url, headers, body] = vi.mocked(HttpClient.post).mock.calls[0];

    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(headers).toEqual({
      Authorization: 'Bearer oa-key',
      'Content-Type': 'application/json',
    });
    expect(body.model).toBe('gpt-4o');
    expect(body.temperature).toBe(0.5);
    expect(body.messages).toEqual(messages);

    expect(out.content).toBe('OPENAI_REPLY');
    expect(out.finish_reason).toBe('stop');
  });

  it('test_openai_stream_yields_tokens_and_handles_tool_calls', async () => {
    const adapter = new OpenAIAdapter({ apiKey: 'oa-key', model: 'gpt-4o' });

    vi.mocked(HttpClient.post).mockImplementation(
      (_url, _headers, _body, opts: any) => {
        if (opts.stream && opts.onChunk) {
          opts.onChunk(
            'data: {"choices": [{"delta": {"content": "Hello"}, "finish_reason": null}]}\n',
          );
          opts.onChunk(
            'data: {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_1", "function": {"name": "read_file", "arguments": "{\\"path\\""}}]}, "finish_reason": null}]}\n',
          );
          opts.onChunk(
            'data: {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": ": \\"a.txt\\"}"}}]}, "finish_reason": "tool_calls"}]}\n',
          );
          opts.onChunk('data: [DONE]\n');
        }
        return Promise.resolve(null);
      },
    );

    const tokens: string[] = [];
    const messages = [{ role: 'user' as const, content: 'hello' }];
    const out = await adapter.completeStream(messages, {}, (tok) => {
      tokens.push(tok);
    });

    expect(tokens).toEqual(['Hello']);
    expect(out.content).toBe('Hello');
    expect(out.finish_reason).toBe('tool_calls');

    const rawChoice = (out.raw as any).choices[0];
    expect(rawChoice.message.role).toBe('assistant');

    const toolCall = rawChoice.message.tool_calls[0];
    expect(toolCall.id).toBe('call_1');
    expect(toolCall.function.name).toBe('read_file');
    expect(toolCall.function.arguments).toBe('{"path": "a.txt"}');
  });

  it('test_openrouter_adapter_default_endpoint_and_routing', () => {
    const client = new Client({ provider: 'openrouter', apiKey: 'or-key' });
    const underlying = client.getAdapter() as any;
    expect(underlying.apiBase).toBe(
      'https://openrouter.ai/api/v1/chat/completions',
    );
    expect(underlying.model).toBe('openai/gpt-4o-mini');
  });

  it('test_deepseek_adapter_default_endpoint_and_routing', () => {
    const client = new Client({ provider: 'deepseek', apiKey: 'ds-key' });
    const underlying = client.getAdapter() as any;
    expect(underlying.apiBase).toBe(
      'https://api.deepseek.com/v1/chat/completions',
    );
    expect(underlying.model).toBe('deepseek-chat');
  });

  it('test_gemini_adapter_default_endpoint_and_routing', () => {
    const client = new Client({ provider: 'gemini', apiKey: 'gem-key' });
    const underlying = client.getAdapter() as any;
    expect(underlying.apiBase).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    );
    expect(underlying.model).toBe('gemini-1.5-flash');
  });
});

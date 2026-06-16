import { LLMAuthError } from '../errors.js';
import { HttpClient } from '../httpClient.js';
import {
  BaseAdapter,
  type CompletionOptions,
  type CompletionResult,
  type LLMMessage,
} from './base.js';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface OpenAIResponse extends Record<string, unknown> {
  choices: Array<{
    message: OpenAIMessage;
    finish_reason?: string | null;
  }>;
}

type OpenAITool = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

interface StreamChunk {
  choices: Array<{
    delta: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

export class OpenAIAdapter extends BaseAdapter {
  protected get defaultApiBase(): string {
    return 'https://api.openai.com/v1/chat/completions';
  }
  protected get defaultModel(): string {
    return 'gpt-4o-mini';
  }

  constructor(config: { apiBase?: string; apiKey?: string; model?: string }) {
    super(config);
    if (!this.apiBase) this.apiBase = this.defaultApiBase;
    if (!this.model) this.model = this.defaultModel;
  }

  public supportsNativeTools(): boolean {
    return true;
  }

  public async complete(
    messages: LLMMessage[],
    options: CompletionOptions = {},
  ): Promise<CompletionResult> {
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      throw new LLMAuthError(
        `Missing API key for provider: ${this.constructor.name}`,
      );
    }

    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages,
    };

    if (options.temperature !== undefined)
      body.temperature = options.temperature;
    if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;
    const tools = this.toOpenAITools(options.tools);
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const json = (await HttpClient.post(this.apiBase, headers, body, {
      timeout: options.timeout,
      signal: options.signal,
    })) as OpenAIResponse;
    const content = json?.choices?.[0]?.message?.content || '';
    const finish_reason = json?.choices?.[0]?.finish_reason || null;
    return { content, raw: json, finish_reason };
  }

  public async completeStream(
    messages: LLMMessage[],
    options: CompletionOptions = {},
    onChunk?: (delta: string) => void,
  ): Promise<CompletionResult> {
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      throw new LLMAuthError(
        `Missing API key for provider: ${this.constructor.name}`,
      );
    }

    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages,
      stream: true,
    };

    if (options.temperature !== undefined)
      body.temperature = options.temperature;
    if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;
    const tools = this.toOpenAITools(options.tools);
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    let total = '';
    let buffer = '';
    const tool_calls: Array<{
      index: number;
      id?: string;
      type?: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }> = [];
    let finish_reason: string | null = null;

    await HttpClient.post(this.apiBase, headers, body, {
      timeout: options.timeout,
      stream: true,
      signal: options.signal,
      onChunk: (chunk: string) => {
        buffer += chunk;
        while (true) {
          const idx = buffer.indexOf('\n');
          if (idx === -1) break;

          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);

          if (!line.startsWith('data: ')) continue;

          const data = line.slice(6).trim();
          if (data.length === 0 || data === '[DONE]') continue;

          try {
            const json = JSON.parse(data) as StreamChunk;
            const delta = json?.choices?.[0]?.delta?.content;
            if (delta && delta.length > 0) {
              onChunk?.(delta);
              total += delta;
            }

            const fr = json?.choices?.[0]?.finish_reason;
            if (fr) finish_reason = fr;

            const tcs = json?.choices?.[0]?.delta?.tool_calls;
            if (Array.isArray(tcs)) {
              for (const tc of tcs) {
                const index = tc.index ?? 0;
                if (!tool_calls[index]) {
                  tool_calls[index] = {
                    index,
                    function: { name: '', arguments: '' },
                  };
                }
                const currentCall = tool_calls[index];
                if (tc.id) currentCall.id = tc.id;
                if (tc.function) {
                  if (tc.function.name)
                    currentCall.function.name += tc.function.name;
                  if (tc.function.arguments)
                    currentCall.function.arguments += tc.function.arguments;
                }
              }
            }
          } catch {
            // Ignore JSON parse errors for incomplete/partial stream lines
          }
        }
      },
    });

    if (tool_calls.length > 0) {
      const raw_response: Record<string, unknown> = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: total,
              tool_calls: tool_calls,
            },
            finish_reason: finish_reason,
          },
        ],
      };
      return { content: total, raw: raw_response, finish_reason };
    } else {
      return { content: total, raw: null, finish_reason };
    }
  }

  private toOpenAITools(tools: CompletionOptions['tools'] = []): OpenAITool[] {
    return tools.map((tool) => {
      if (
        'type' in tool &&
        tool.type === 'function' &&
        'function' in tool
      ) {
        return tool;
      }

      const auraTool = tool as {
        name: string;
        description?: string;
        input_schema?: Record<string, unknown>;
      };
      return {
        type: 'function',
        function: {
          name: auraTool.name,
          description: auraTool.description || '',
          parameters: auraTool.input_schema || {
            type: 'object',
            properties: {},
          },
        },
      };
    });
  }
}

export class OpenRouterAdapter extends OpenAIAdapter {
  protected get defaultApiBase(): string {
    return 'https://openrouter.ai/api/v1/chat/completions';
  }
  protected get defaultModel(): string {
    return 'openai/gpt-4o-mini';
  }
}

export class DeepSeekAdapter extends OpenAIAdapter {
  protected get defaultApiBase(): string {
    return 'https://api.deepseek.com/v1/chat/completions';
  }
  protected get defaultModel(): string {
    return 'deepseek-chat';
  }
}

export class GeminiAdapter extends OpenAIAdapter {
  protected get defaultApiBase(): string {
    return 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  }
  protected get defaultModel(): string {
    return 'gemini-2.5-flash';
  }
}

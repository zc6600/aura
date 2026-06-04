import { BaseAdapter, CompletionResult } from './base.js';
import { HttpClient } from '../httpClient.js';
import { LLMAuthError } from '../errors.js';

export class OpenAIAdapter extends BaseAdapter {
  protected get defaultApiBase(): string { return 'https://api.openai.com/v1/chat/completions'; }
  protected get defaultModel(): string { return 'gpt-4o-mini'; }

  constructor(config: { apiBase?: string; apiKey?: string; model?: string }) {
    super(config);
    if (!this.apiBase) this.apiBase = this.defaultApiBase;
    if (!this.model) this.model = this.defaultModel;
  }

  public supportsNativeTools(): boolean {
    return true;
  }

  public async complete(messages: any[], options: any = {}): Promise<CompletionResult> {
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      throw new LLMAuthError(`Missing API key for provider: ${this.constructor.name}`);
    }

    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    const body: Record<string, any> = {
      model: this.model,
      messages: messages,
    };

    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
      body.tool_choice = 'auto';
    }

    const json = await HttpClient.post(this.apiBase, headers, body, { timeout: options.timeout });
    const content = json?.choices?.[0]?.message?.content || '';
    const finish_reason = json?.choices?.[0]?.finish_reason || null;
    return { content, raw: json, finish_reason };
  }

  public async completeStream(
    messages: any[],
    options: any = {},
    onChunk?: (delta: string) => void
  ): Promise<CompletionResult> {
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      throw new LLMAuthError(`Missing API key for provider: ${this.constructor.name}`);
    }

    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    const body: Record<string, any> = {
      model: this.model,
      messages: messages,
      stream: true,
    };

    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
      body.tool_choice = 'auto';
    }

    let total = '';
    let buffer = '';
    const tool_calls: any[] = [];
    let finish_reason: string | null = null;

    await HttpClient.post(this.apiBase, headers, body, {
      timeout: options.timeout,
      stream: true,
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
            const json = JSON.parse(data);
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
                  tool_calls[index] = { function: { name: '', arguments: '' } };
                }
                if (tc.id) tool_calls[index].id = tc.id;
                if (tc.function) {
                  if (tc.function.name) tool_calls[index].function.name += tc.function.name;
                  if (tc.function.arguments) tool_calls[index].function.arguments += tc.function.arguments;
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
      const raw_response = {
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
}

export class OpenRouterAdapter extends OpenAIAdapter {
  protected get defaultApiBase(): string { return 'https://openrouter.ai/api/v1/chat/completions'; }
  protected get defaultModel(): string { return 'openai/gpt-4o-mini'; }
}

export class DeepSeekAdapter extends OpenAIAdapter {
  protected get defaultApiBase(): string { return 'https://api.deepseek.com/v1/chat/completions'; }
  protected get defaultModel(): string { return 'deepseek-chat'; }
}

export class GeminiAdapter extends OpenAIAdapter {
  protected get defaultApiBase(): string { return 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'; }
  protected get defaultModel(): string { return 'gemini-1.5-flash'; }
}

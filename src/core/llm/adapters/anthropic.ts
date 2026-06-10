import { LLMAuthError } from '../errors.js';
import { HttpClient } from '../httpClient.js';
import {
  BaseAdapter,
  type CompletionOptions,
  type CompletionResult,
  type LLMMessage,
} from './base.js';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicResponse extends Record<string, unknown> {
  content: Array<{ text: string }>;
  stop_reason?: string | null;
}

interface StreamChunk {
  type: 'content_block_delta' | 'message_delta' | string;
  delta?: {
    text?: string;
    stop_reason?: string | null;
  };
}

export class AnthropicAdapter extends BaseAdapter {
  constructor(config: { apiBase?: string; apiKey?: string; model?: string }) {
    super(config);
    if (!this.apiBase) this.apiBase = 'https://api.anthropic.com/v1/messages';
    if (!this.model) this.model = 'claude-3-5-sonnet-20241022';
  }

  public async complete(
    messages: LLMMessage[],
    options: CompletionOptions = {},
  ): Promise<CompletionResult> {
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      throw new LLMAuthError('Missing ANTHROPIC_API_KEY');
    }

    const headers = {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    };

    const [systemPrompt, cleanedMsgs] = this.extractSystemAndMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: cleanedMsgs,
      max_tokens: options.max_tokens || 4096,
    };

    if (options.temperature !== undefined)
      body.temperature = options.temperature;
    if (systemPrompt) body.system = systemPrompt;

    const json = (await HttpClient.post(this.apiBase, headers, body, {
      timeout: options.timeout,
    })) as AnthropicResponse;
    const content = json?.content?.[0]?.text || '';
    const finish_reason = json?.stop_reason || null;
    return { content, raw: json, finish_reason };
  }

  public async completeStream(
    messages: LLMMessage[],
    options: CompletionOptions = {},
    onChunk?: (delta: string) => void,
  ): Promise<CompletionResult> {
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      throw new LLMAuthError('Missing ANTHROPIC_API_KEY');
    }

    const headers = {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    };

    const [systemPrompt, cleanedMsgs] = this.extractSystemAndMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: cleanedMsgs,
      max_tokens: options.max_tokens || 4096,
      stream: true,
    };

    if (options.temperature !== undefined)
      body.temperature = options.temperature;
    if (systemPrompt) body.system = systemPrompt;

    let total = '';
    let buffer = '';
    let stop_reason: string | null = null;

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
          if (data.length === 0) continue;

          try {
            const json = JSON.parse(data) as StreamChunk;
            if (json.type === 'content_block_delta') {
              const delta = json.delta?.text;
              if (delta && delta.length > 0) {
                onChunk?.(delta);
                total += delta;
              }
            } else if (json.type === 'message_delta') {
              const sr = json.delta?.stop_reason;
              if (sr) stop_reason = sr;
            }
          } catch {
            // Ignore JSON parse errors for incomplete/partial stream lines
          }
        }
      },
    });

    return { content: total, raw: null, finish_reason: stop_reason };
  }

  private extractSystemAndMessages(
    messages: LLMMessage[],
  ): [string | null, AnthropicMessage[]] {
    let systemPrompt: string | null = null;
    const cleanedMessages: AnthropicMessage[] = [];

    for (const msg of messages) {
      const role = msg.role;
      const content = msg.content;
      if (role === 'system') {
        systemPrompt = String(content ?? '');
      } else if (role === 'user' || role === 'assistant') {
        cleanedMessages.push({ role, content: String(content ?? '') });
      }
    }
    return [systemPrompt, cleanedMessages];
  }
}

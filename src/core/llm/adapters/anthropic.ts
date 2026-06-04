import { BaseAdapter, CompletionResult } from './base.js';
import { HttpClient } from '../httpClient.js';
import { LLMAuthError } from '../errors.js';

export class AnthropicAdapter extends BaseAdapter {
  constructor(config: { apiBase?: string; apiKey?: string; model?: string }) {
    super(config);
    if (!this.apiBase) this.apiBase = 'https://api.anthropic.com/v1/messages';
    if (!this.model) this.model = 'claude-3-5-sonnet-20241022';
  }

  public async complete(messages: any[], options: any = {}): Promise<CompletionResult> {
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      throw new LLMAuthError('Missing ANTHROPIC_API_KEY');
    }

    const headers = {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    };

    const [systemPrompt, cleanedMsgs] = this.extractSystemAndMessages(messages);

    const body: Record<string, any> = {
      model: this.model,
      messages: cleanedMsgs,
      max_tokens: options.max_tokens || 4096,
    };

    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (systemPrompt) body.system = systemPrompt;

    const json = await HttpClient.post(this.apiBase, headers, body, { timeout: options.timeout });
    const content = json?.content?.[0]?.text || '';
    const finish_reason = json?.stop_reason || null;
    return { content, raw: json, finish_reason };
  }

  public async completeStream(
    messages: any[],
    options: any = {},
    onChunk?: (delta: string) => void
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

    const body: Record<string, any> = {
      model: this.model,
      messages: cleanedMsgs,
      max_tokens: options.max_tokens || 4096,
      stream: true,
    };

    if (options.temperature !== undefined) body.temperature = options.temperature;
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
            const json = JSON.parse(data);
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

  private extractSystemAndMessages(messages: any[]): [string | null, any[]] {
    let systemPrompt: string | null = null;
    const cleanedMessages: any[] = [];

    for (const msg of messages) {
      const role = msg.role;
      const content = msg.content;
      if (String(role) === 'system') {
        systemPrompt = String(content);
      } else {
        cleanedMessages.push({ role: String(role), content: String(content) });
      }
    }
    return [systemPrompt, cleanedMessages];
  }
}

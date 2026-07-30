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

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicResponse extends Record<string, unknown> {
  content: AnthropicContentBlock[];
  stop_reason?: string | null;
}

type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
};

interface StreamChunk {
  type:
    | 'content_block_start'
    | 'content_block_delta'
    | 'message_delta'
    | string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: {
    type?: 'text_delta' | 'input_json_delta' | string;
    text?: string;
    partial_json?: string;
    stop_reason?: string | null;
  };
}

export class AnthropicAdapter extends BaseAdapter {
  constructor(config: { apiBase?: string; apiKey?: string; model?: string }) {
    super(config);
    if (!this.apiBase) this.apiBase = 'https://api.anthropic.com/v1/messages';
    if (!this.model) this.model = 'claude-3-5-haiku-20241022';
  }

  public supportsNativeTools(): boolean {
    return true;
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
    const tools = this.toAnthropicTools(options.tools);
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = { type: 'auto' };
    }

    const json = (await HttpClient.post(this.apiBase, headers, body, {
      timeout: options.timeout,
      signal: options.signal,
    })) as AnthropicResponse;
    const finish_reason = json?.stop_reason || null;
    const blocks = Array.isArray(json?.content) ? json.content : [];
    const content = blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text || '')
      .join('');

    const toolUseBlocks = blocks.filter((b) => b.type === 'tool_use');
    if (toolUseBlocks.length > 0) {
      const raw = {
        tool_calls: toolUseBlocks.map((b) => ({
          id: b.id,
          name: b.name,
          input: b.input || {},
        })),
        content,
      };
      return { content, raw, finish_reason };
    }

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
    const tools = this.toAnthropicTools(options.tools);
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = { type: 'auto' };
    }

    let total = '';
    let buffer = '';
    let stop_reason: string | null = null;
    const blocks: Record<
      number,
      { type: string; text: string; id?: string; name?: string; jsonBuf: string }
    > = {};

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
          if (data.length === 0) continue;

          try {
            const json = JSON.parse(data) as StreamChunk;
            if (json.type === 'content_block_start') {
              const index = json.index ?? 0;
              const cb = json.content_block;
              blocks[index] = {
                type: cb?.type || 'text',
                text: '',
                id: cb?.id,
                name: cb?.name,
                jsonBuf: '',
              };
            } else if (json.type === 'content_block_delta') {
              const index = json.index ?? 0;
              const block =
                blocks[index] ||
                (blocks[index] = { type: 'text', text: '', jsonBuf: '' });

              if (json.delta?.type === 'input_json_delta') {
                block.jsonBuf += json.delta.partial_json || '';
              } else {
                const delta = json.delta?.text;
                if (delta && delta.length > 0) {
                  block.text += delta;
                  onChunk?.(delta);
                  total += delta;
                }
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

    const toolUseBlocks = Object.values(blocks).filter(
      (b) => b.type === 'tool_use',
    );
    if (toolUseBlocks.length > 0) {
      const tool_calls = toolUseBlocks.map((b) => {
        let input: Record<string, unknown> = {};
        try {
          input = b.jsonBuf ? JSON.parse(b.jsonBuf) : {};
        } catch {
          input = {};
        }
        return { id: b.id, name: b.name, input };
      });
      return {
        content: total,
        raw: { tool_calls, content: total },
        finish_reason: stop_reason,
      };
    }

    return { content: total, raw: null, finish_reason: stop_reason };
  }

  private toAnthropicTools(
    tools: CompletionOptions['tools'] = [],
  ): AnthropicTool[] {
    return tools.map((tool) => {
      if ('function' in tool && tool.type === 'function') {
        return {
          name: tool.function.name,
          description: tool.function.description || '',
          input_schema: tool.function.parameters || {
            type: 'object',
            properties: {},
          },
        };
      }

      const auraTool = tool as {
        name: string;
        description?: string;
        input_schema?: Record<string, unknown>;
      };
      return {
        name: auraTool.name,
        description: auraTool.description || '',
        input_schema: auraTool.input_schema || {
          type: 'object',
          properties: {},
        },
      };
    });
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

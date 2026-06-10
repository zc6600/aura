export interface AdapterConfig {
  apiBase?: string;
  apiKey?: string;
  model?: string;
}

export interface LLMMessage {
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

export interface CompletionOptions {
  temperature?: number;
  max_tokens?: number;
  timeout?: number;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
    };
  }>;
  tool_choice?:
    | 'auto'
    | 'none'
    | { type: 'function'; function: { name: string } };
  stream?: boolean;
  [key: string]: unknown;
}

export interface CompletionResult {
  content: string;
  raw: Record<string, unknown> | null;
  finish_reason?: string | null;
}

export abstract class BaseAdapter {
  protected apiBase: string;
  protected apiKey?: string;
  protected model: string;

  constructor(config: AdapterConfig) {
    this.apiBase = config.apiBase || '';
    this.apiKey = config.apiKey;
    this.model = config.model || '';
  }

  /**
   * Indicates if the provider supports native tool schemas (e.g. OpenAI tools spec).
   */
  public supportsNativeTools(): boolean {
    return false;
  }

  /**
   * Executes a standard non-streaming completion.
   */
  public abstract complete(
    messages: LLMMessage[],
    options?: CompletionOptions,
  ): Promise<CompletionResult>;

  /**
   * Executes a streaming completion.
   */
  public abstract completeStream(
    messages: LLMMessage[],
    options?: CompletionOptions,
    onChunk?: (delta: string) => void,
  ): Promise<CompletionResult>;
}

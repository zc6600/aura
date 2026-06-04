export interface AdapterConfig {
  apiBase?: string;
  apiKey?: string;
  model?: string;
}

export interface CompletionResult {
  content: string;
  raw: any;
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
  public abstract complete(messages: any[], options?: any): Promise<CompletionResult>;

  /**
   * Executes a streaming completion.
   */
  public abstract completeStream(
    messages: any[],
    options?: any,
    onChunk?: (delta: string) => void
  ): Promise<CompletionResult>;
}

import type { BaseAdapter } from './adapters/base.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stream?: boolean;
  invoked_tools?: any[];
  signal?: AbortSignal;
  [key: string]: any;
}

export type AdapterConstructor = new (config: ProviderConfig) => BaseAdapter;

export interface ProviderConfig {
  provider: string;
  apiBase?: string;
  apiKey?: string;
  model?: string;
  maxRetries?: number;
}

export interface LLMConfig {
  provider?: string;
  api_key?: string;
  api_key_env?: string;
  api_base?: string;
  model?: string;
  max_retries?: number;
  fallbacks?: FallbackConfig[];
  backup?: FallbackConfig;
}

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface FallbackConfig {
  provider?: string;
  api_key?: string;
  api_key_env?: string;
  api_base?: string;
  model?: string;
  max_retries?: number;
}

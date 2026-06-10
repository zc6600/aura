import {
  BaseAdapter,
  type CompletionOptions,
  type CompletionResult,
  type LLMMessage,
} from './base.js';

export class LocalAdapter extends BaseAdapter {
  public async complete(
    _messages: LLMMessage[],
    _options?: CompletionOptions,
  ): Promise<CompletionResult> {
    throw new Error(
      "⛔️ Error: The default 'local' provider is an offline mock adapter. Please configure a real LLM provider (e.g. 'openai' or 'openrouter') by setting your API key in the environment (e.g. export OPENAI_API_KEY=...) and configuring llm.provider in config.yml.",
    );
  }

  public async completeStream(
    _messages: LLMMessage[],
    _options?: CompletionOptions,
    _onChunk?: (delta: string) => void,
  ): Promise<CompletionResult> {
    throw new Error(
      "⛔️ Error: The default 'local' provider is an offline mock adapter. Please configure a real LLM provider (e.g. 'openai' or 'openrouter') by setting your API key in the environment (e.g. export OPENAI_API_KEY=...) and configuring llm.provider in config.yml.",
    );
  }
}

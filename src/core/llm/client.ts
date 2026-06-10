import { AnthropicAdapter } from './adapters/anthropic.js';
import type { BaseAdapter, CompletionResult } from './adapters/base.js';
import { LocalAdapter } from './adapters/local.js';
import {
  DeepSeekAdapter,
  GeminiAdapter,
  OpenAIAdapter,
  OpenRouterAdapter,
} from './adapters/openai.js';
import * as Env from './env.js';
import {
  LLMAuthError,
  LLMBadRequestError,
  LLMError,
  LLMRateLimitError,
  LLMServerError,
  LLMTimeoutError,
  StreamAbortedError,
} from './errors.js';
import type {
  AdapterConstructor,
  ChatMessage,
  CompletionOptions,
  LLMConfig,
  ProviderConfig,
} from './types.js';

interface ProviderHealth {
  failureCount: number;
  lastFailedAt: number | null;
  probing: boolean;
}

const adaptersRegistry: Record<string, AdapterConstructor> = {
  local: LocalAdapter,
  openai: OpenAIAdapter,
  openrouter: OpenRouterAdapter,
  deepseek: DeepSeekAdapter,
  gemini: GeminiAdapter,
  anthropic: AnthropicAdapter,
};

export class Client {
  public static registerAdapter(
    providerName: string,
    klass: AdapterConstructor,
  ): void {
    adaptersRegistry[providerName.toLowerCase()] = klass;
  }

  public static llmWarningsEnabled(): boolean {
    if (process.env.AURA_SILENCE_LLM_WARNINGS === '1') return false;
    if (process.env.AURA_LLM_WARNINGS === '1') return true;
    // Suppress warnings in test environments
    return process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true';
  }

  public fallbacks: ProviderConfig[] = [];
  public maxRetries: number = 2;

  private primaryConfig: ProviderConfig;
  private currentConfig: ProviderConfig;
  private adapter: BaseAdapter;
  private healthRegistry = new Map<string, ProviderHealth>();

  constructor(options: {
    provider: string;
    apiBase?: string;
    apiKey?: string;
    model?: string;
  }) {
    this.primaryConfig = {
      provider: options.provider || 'local',
      apiBase: options.apiBase,
      apiKey: options.apiKey,
      model: options.model,
    };
    this.currentConfig = this.primaryConfig;
    this.adapter = this.buildAdapter(this.currentConfig);
  }

  /**
   * Instantiates a Client using values loaded from config objects and environment paths.
   */
  public static fromConfig(
    config: LLMConfig | null,
    projectPath?: string,
  ): Client {
    if (!config) {
      return new Client({ provider: 'local' });
    }

    if (projectPath) {
      Env.loadFrom(projectPath);
    }

    const provider = config.provider || 'local';

    // Resolve primary API key
    let apiKey = config.api_key;
    const apiKeyEnv = config.api_key_env;
    if (apiKeyEnv && process.env[apiKeyEnv]) {
      apiKey = process.env[apiKeyEnv];
    }
    if (!apiKey && provider) {
      apiKey = Env.resolveApiKey(provider);
    }

    const fallbacks: ProviderConfig[] = [];

    // Parse fallbacks array
    const rawFallbacks = config.fallbacks || [];
    const fallbackList = Array.isArray(rawFallbacks)
      ? rawFallbacks
      : [rawFallbacks];
    for (const fb of fallbackList) {
      const fbProvider = fb.provider;
      if (!fbProvider || fbProvider.trim().length === 0) {
        if (Client.llmWarningsEnabled()) {
          console.warn(
            '\x1b[31m⚠️ Invalid fallback configuration: missing "provider"\x1b[0m',
          );
        }
        continue;
      }

      let fbKey = fb.api_key;
      const fbKeyEnv = fb.api_key_env;
      if (fbKeyEnv && process.env[fbKeyEnv]) {
        fbKey = process.env[fbKeyEnv];
      }
      if (!fbKey) {
        fbKey = Env.resolveApiKey(fbProvider);
      }

      fallbacks.push({
        provider: fbProvider,
        apiBase: fb.api_base,
        apiKey: fbKey,
        model: fb.model,
        maxRetries: fb.max_retries,
      });
    }

    // Support singular "backup" key
    const backupCfg = config.backup;
    if (fallbacks.length === 0 && backupCfg && typeof backupCfg === 'object') {
      const fbProvider = backupCfg.provider;
      if (!fbProvider || fbProvider.trim().length === 0) {
        if (Client.llmWarningsEnabled()) {
          console.warn(
            '\x1b[31m⚠️ Invalid backup configuration: missing "provider"\x1b[0m',
          );
        }
      } else {
        let fbKey = backupCfg.api_key;
        const fbKeyEnv = backupCfg.api_key_env;
        if (fbKeyEnv && process.env[fbKeyEnv]) {
          fbKey = process.env[fbKeyEnv];
        }
        if (!fbKey) {
          fbKey = Env.resolveApiKey(fbProvider);
        }
        fallbacks.push({
          provider: fbProvider,
          apiBase: backupCfg.api_base,
          apiKey: fbKey,
          model: backupCfg.model,
          maxRetries: backupCfg.max_retries,
        });
      }
    }

    const maxRetries =
      config.max_retries !== undefined ? config.max_retries : 2;

    const client = new Client({
      provider,
      apiBase: config.api_base,
      apiKey,
      model: config.model,
    });
    client.fallbacks = fallbacks;
    client.maxRetries = maxRetries;

    // Validate active configurations
    const allConfigs = client.configsChain();
    const validConfigs = allConfigs.filter(
      (cfg) => cfg.apiKey && cfg.apiKey.trim().length > 0,
    );

    if (validConfigs.length === 0) {
      if (Client.llmWarningsEnabled()) {
        console.warn(
          '\x1b[31m⚠️  Warning: No valid LLM configurations found. Primary and all fallbacks are missing API keys.\x1b[0m',
        );
      }
    } else if (validConfigs.length < allConfigs.length) {
      if (Client.llmWarningsEnabled()) {
        console.warn(
          `\x1b[33m⚠️  Warning: ${
            allConfigs.length - validConfigs.length
          } of ${allConfigs.length} LLM configurations have invalid or missing API keys.\x1b[0m`,
        );
      }
    }

    return client;
  }

  /**
   * Get a chain of all configurations: primary followed by fallbacks.
   */
  public configsChain(): ProviderConfig[] {
    return [this.primaryConfig, ...this.fallbacks];
  }

  public supportsNativeTools(): boolean {
    return this.adapter.supportsNativeTools();
  }

  public async complete(
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): Promise<CompletionResult> {
    return this.withFallback((adapter) => adapter.complete(messages, options));
  }

  public async completeStream(
    messages: ChatMessage[],
    options: CompletionOptions = {},
    onChunk?: (delta: string) => void,
  ): Promise<CompletionResult> {
    let hasYielded = false;

    try {
      return await this.withFallback(async (adapter) => {
        try {
          return await adapter.completeStream(messages, options, (delta) => {
            hasYielded = true;
            onChunk?.(delta);
          });
        } catch (err) {
          // If we've already yielded streaming content, abort fallback/retry chain
          if (hasYielded) {
            throw new StreamAbortedError(
              err instanceof Error ? err : new Error(String(err)),
            );
          }
          throw err;
        }
      });
    } catch (err) {
      if (err instanceof StreamAbortedError) {
        throw err.originalError;
      }
      throw err;
    }
  }

  private async withFallback<T>(
    fn: (adapter: BaseAdapter, config: ProviderConfig) => Promise<T>,
  ): Promise<T> {
    const configsToTry = this.configsChain();
    let activeConfigs = this.filterConfigs(configsToTry);

    if (activeConfigs.length === 0) {
      activeConfigs = configsToTry;
    }

    let lastError: Error | null = null;

    for (let idx = 0; idx < activeConfigs.length; idx++) {
      const config = activeConfigs[idx];

      if (config !== this.currentConfig) {
        this.currentConfig = config;
        this.adapter = this.buildAdapter(this.currentConfig);
      }

      const configRetries =
        config.maxRetries !== undefined ? config.maxRetries : this.maxRetries;
      const maxAttempts = configRetries + 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const result = await fn(this.adapter, config);
          this.resetProviderHealth(config);
          return result;
        } catch (err: unknown) {
          if (err instanceof StreamAbortedError) {
            throw err;
          }
          lastError = err instanceof Error ? err : new Error(String(err));
          this.recordProviderFailure(config);

          // Skip retrying if error is not retryable (e.g., Auth or Bad Request)
          if (!this.isRetryableError(lastError)) {
            break;
          }

          const warnMessage = `LLM request failed using provider "${config.provider}" (attempt ${attempt}/${maxAttempts}): ${lastError.message}`;
          this.emitWarningMessage(warnMessage);

          if (attempt < maxAttempts) {
            // Exponential backoff: 2 ** (attempt - 1) up to a cap of 10s
            const backoffTime = Math.min(2 ** (attempt - 1), 10);
            await this.getSleep(backoffTime);
          }
        }
      }

      if (idx + 1 < activeConfigs.length) {
        const nextConfig = activeConfigs[idx + 1];
        const switchMsg = `Provider "${config.provider}" failed all attempts. Switching to backup provider "${nextConfig.provider}"...`;
        this.emitWarningMessage(switchMsg);
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new LLMError('LLM request failed (no active configuration)');
  }

  private filterConfigs(configs: ProviderConfig[]): ProviderConfig[] {
    const now = Date.now();
    return configs.filter((cfg) => {
      const key = this.configKey(cfg);
      const health = this.healthRegistry.get(key);

      if (health && health.failureCount >= 3) {
        const timeDiff = now - (health.lastFailedAt || 0);
        if (timeDiff < 30000) {
          return false;
        } else {
          // Cooldown expired: allow a probe attempt
          health.failureCount = 2;
          health.probing = true;
          return true;
        }
      }
      return true;
    });
  }

  private recordProviderFailure(cfg: ProviderConfig): void {
    const key = this.configKey(cfg);
    let health = this.healthRegistry.get(key);

    if (!health) {
      health = { failureCount: 0, lastFailedAt: null, probing: false };
      this.healthRegistry.set(key, health);
    }

    health.failureCount += 1;
    health.lastFailedAt = Date.now();

    if (health.probing) {
      health.failureCount += 1;
      health.probing = false;
    }
  }

  private resetProviderHealth(cfg: ProviderConfig): void {
    const key = this.configKey(cfg);
    this.healthRegistry.set(key, {
      failureCount: 0,
      lastFailedAt: null,
      probing: false,
    });
  }

  private configKey(cfg: ProviderConfig): string {
    return `${cfg.provider}_${cfg.model || ''}_${cfg.apiBase || ''}`;
  }

  private isRetryableError(error: Error): boolean {
    if (error instanceof LLMAuthError || error instanceof LLMBadRequestError) {
      return false;
    }
    if (
      error instanceof LLMTimeoutError ||
      error instanceof LLMRateLimitError ||
      error instanceof LLMServerError
    ) {
      return true;
    }
    // Default to true for connection errors (wrapped in LLMError)
    if (error instanceof LLMError) {
      return true;
    }
    return false;
  }

  private emitWarningMessage(msg: string): void {
    if (!Client.llmWarningsEnabled()) return;
    console.warn(`\x1b[33m⚠️  ${msg}\x1b[0m`);
  }

  protected async sleep(seconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }

  public getAdapter(): BaseAdapter {
    return this.adapter;
  }

  /**
   * Public sleep entry point. Tests spy on this method to intercept delays.
   * withFallback calls this.getSleep(seconds) so spies are triggered.
   */
  public async getSleep(seconds: number): Promise<void> {
    return this.sleep(seconds);
  }

  public getCurrentConfig(): ProviderConfig {
    return this.currentConfig;
  }

  public getBuildAdapter(): (config: ProviderConfig) => BaseAdapter {
    return (config: ProviderConfig) => this.buildAdapter(config);
  }

  private buildAdapter(config: ProviderConfig): BaseAdapter {
    const provider = (config.provider || 'local').toLowerCase();
    const klass = adaptersRegistry[provider];

    if (!klass) {
      return new LocalAdapter(config);
    }

    return new klass(config);
  }
}

export { Client as LLMClient };

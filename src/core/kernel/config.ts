import { loadTyped } from '../../utils/configManager.js';
import {
  type LLMConfig,
  parseAuraConfig,
} from '../../utils/configSchema.js';

export interface SystemConfigView {
  max_steps: number;
  max_format_errors: number;
  max_tool_errors: number;
  /** Max consecutive empty/blank tool results before aborting. */
  max_empty_results: number;
  /** Max consecutive calls to the same tool (by name+normalized-argument fingerprint) before aborting. */
  max_repeat_calls: number;
}

export interface RalphConfigView {
  max_steps: number;
  timeout: number;
  verify_command?: string;
  critic_mode: 'light' | 'heavy';
  use_critic?: boolean;
}

export interface ToolProtocolConfigView {
  callSummaryMaxChars: number | null;
}

export interface SandboxConfigView {
  enabled: boolean;
  /** Left undefined (not defaulted) when unset in config.yml — an unset provider means "no sandboxing wrapper applied", distinct from provider 'local'. */
  provider?: 'docker' | 'local';
  image: string;
  allowPaths: string[];
  unattendedFullAccess: boolean;
  unattendedRetryThreshold: number;
}

/**
 * Typed, defaulted view over the Kernel-relevant slices of config.yml
 * (llm/system/ralph/tool_protocol/security.sandbox). Mirrors MemoryConfig's
 * pattern for the Memory bounded context: wrap the raw blob once, expose
 * getters that own their own default-merging instead of scattering `?? ...`
 * fallbacks across every call site.
 */
export class KernelConfig {
  private static readonly DEFAULT_SYSTEM: SystemConfigView = {
    max_steps: 30,
    max_format_errors: 5,
    max_tool_errors: 3,
    max_empty_results: 5,
    max_repeat_calls: 4,
  };

  private static readonly DEFAULT_RALPH_MAX_STEPS = 100;
  private static readonly DEFAULT_RALPH_TIMEOUT = 45; // seconds
  private static readonly DEFAULT_RALPH_CRITIC_MODE = 'light' as const;

  private static readonly DEFAULT_SANDBOX_IMAGE = 'aura-sandbox:latest';
  private static readonly DEFAULT_SANDBOX_RETRY_THRESHOLD = 3;

  private readonly raw: Record<string, unknown>;

  constructor(raw: Record<string, unknown> = {}) {
    this.raw = raw || {};
  }

  public static fromFile(envPath: string): KernelConfig {
    try {
      return new KernelConfig(loadTyped(envPath));
    } catch (_e) {
      return new KernelConfig(parseAuraConfig({}));
    }
  }

  public get llm(): LLMConfig | null {
    return (this.raw.llm as LLMConfig) ?? null;
  }

  public get system(): SystemConfigView {
    const cfg = (this.raw.system as Partial<SystemConfigView>) ?? {};
    return {
      max_steps: cfg.max_steps ?? KernelConfig.DEFAULT_SYSTEM.max_steps,
      max_format_errors:
        cfg.max_format_errors ?? KernelConfig.DEFAULT_SYSTEM.max_format_errors,
      max_tool_errors:
        cfg.max_tool_errors ?? KernelConfig.DEFAULT_SYSTEM.max_tool_errors,
      max_empty_results:
        cfg.max_empty_results ?? KernelConfig.DEFAULT_SYSTEM.max_empty_results,
      max_repeat_calls:
        cfg.max_repeat_calls ?? KernelConfig.DEFAULT_SYSTEM.max_repeat_calls,
    };
  }

  /**
   * Only defaults the values config.yml itself governs. Deliberately does
   * NOT infer use_critic from critic_mode — that inference depends on
   * RalphLoop's already-resolved criticMode (which may include a runtime
   * `options.critic_mode` override this class never sees), so it stays in
   * ralphLoop.ts.
   */
  public get ralph(): RalphConfigView {
    const cfg = (this.raw.ralph as Partial<RalphConfigView>) ?? {};
    return {
      max_steps: cfg.max_steps ?? KernelConfig.DEFAULT_RALPH_MAX_STEPS,
      timeout: cfg.timeout ?? KernelConfig.DEFAULT_RALPH_TIMEOUT,
      verify_command: cfg.verify_command,
      critic_mode: cfg.critic_mode ?? KernelConfig.DEFAULT_RALPH_CRITIC_MODE,
      use_critic: cfg.use_critic,
    };
  }

  public get toolProtocol(): ToolProtocolConfigView {
    const toolProtocol = (this.raw.tool_protocol as Record<string, unknown>) ?? {};
    const callSummary = (toolProtocol.call_summary as Record<string, unknown>) ?? {};
    const maxChars = callSummary.max_chars;
    return {
      callSummaryMaxChars: typeof maxChars === 'number' ? maxChars : null,
    };
  }

  public get sandbox(): SandboxConfigView {
    const security = (this.raw.security as Record<string, unknown>) ?? {};
    const cfg = (security.sandbox as Record<string, unknown>) ?? {};
    return {
      enabled: cfg.enabled === true,
      // Not defaulted on purpose — see SandboxConfigView.provider.
      provider: cfg.provider as 'docker' | 'local' | undefined,
      image: (cfg.image as string) ?? KernelConfig.DEFAULT_SANDBOX_IMAGE,
      allowPaths: (cfg.allow_paths as string[]) ?? [],
      unattendedFullAccess: cfg.unattended_full_access === true,
      unattendedRetryThreshold:
        (cfg.unattended_retry_threshold as number) ??
        KernelConfig.DEFAULT_SANDBOX_RETRY_THRESHOLD,
    };
  }
}

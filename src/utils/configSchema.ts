/**
 * Zod schemas for Aura configuration files (.aura/config.yml).
 *
 * Provides runtime validation + inferred TypeScript types for all config sections.
 * This replaces `Record<string, any>` / `any` config objects throughout the codebase.
 *
 * Usage:
 *   import { AuraConfigSchema, type AuraConfig } from './configSchema.js';
 *   const cfg = AuraConfigSchema.parse(rawYaml);
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// LLM / Provider config
// ---------------------------------------------------------------------------

const FallbackProviderSchema = z
  .object({
    provider: z.string().min(1),
    api_base: z.string().optional(),
    api_key: z.string().optional(),
    api_key_env: z.string().optional(),
    model: z.string().optional(),
    max_retries: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const LLMConfigSchema = z
  .object({
    provider: z.string().default('local'),
    api_base: z.string().optional(),
    api_key: z.string().optional(),
    api_key_env: z.string().optional(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().optional(),
    max_retries: z.number().int().nonnegative().optional(),
    fallbacks: z.array(FallbackProviderSchema).default([]),
    /** Legacy singular backup key */
    backup: FallbackProviderSchema.optional(),
  })
  .passthrough();

export type LLMConfig = z.infer<typeof LLMConfigSchema>;

// ---------------------------------------------------------------------------
// Tool protocol config
// ---------------------------------------------------------------------------

const CallOutputSchema = z
  .object({
    max_chars: z.number().int().positive().optional(),
    head_ratio: z.number().min(0).max(1).optional(),
  })
  .passthrough();

const BashProtocolSchema = z
  .object({
    base_wait_seconds: z.number().positive().optional(),
  })
  .passthrough();

export const ToolProtocolConfigSchema = z
  .object({
    default_timeout_seconds: z.number().positive().default(300),
    max_timeout_seconds: z.number().positive().default(1200),
    agent_can_modify_timeout: z.boolean().default(true),
    runtimes: z.record(z.string()).default({}),
    call_output: CallOutputSchema.optional(),
    bash: BashProtocolSchema.optional(),
    call_summary: z
      .object({
        max_chars: z.number().int().positive().optional(),
        suggested_chars: z.number().int().positive().optional(),
        attach_max_chars: z.number().int().positive().optional(),
      })
      .optional(),
    allow_dependency_install: z.boolean().optional(),
    test_timeout: z.number().positive().optional(),
    core_tools: z.array(z.string()).optional(),
    auto_verify: z.array(z.string()).optional(),
    required_files: z.array(z.string()).optional(),
  })
  .passthrough();

export type ToolProtocolConfig = z.infer<typeof ToolProtocolConfigSchema>;

// ---------------------------------------------------------------------------
// Security config
// ---------------------------------------------------------------------------

export const SecurityConfigSchema = z
  .object({
    strict_path_isolation: z.boolean().default(false),
    forbidden_extensions: z.array(z.string()).default([]),
    read_only_directories: z.array(z.string()).default([]),
    git_snapshots: z.boolean().default(false),
    sandbox: z
      .object({
        enabled: z.boolean().default(false),
        provider: z.enum(['docker', 'local']).optional(),
        image: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

// ---------------------------------------------------------------------------
// State management / memory config
// ---------------------------------------------------------------------------

export const StateManagementConfigSchema = z
  .object({
    // Legacy fields
    max_events: z.number().int().positive().optional(),
    summary_threshold: z.number().int().positive().optional(),
    summarize_on_start: z.boolean().optional(),
    keep_recent: z.number().int().positive().optional(),
    // Actual fields
    database_type: z.string().optional(),
    db_path: z.string().optional(),
    max_state_chars: z.number().int().positive().optional(),
    keep_last_summary_n_steps: z.number().int().positive().optional(),
    recent_events_n: z.number().int().positive().optional(),
    summarization: z
      .object({
        enabled: z.boolean().optional(),
        max_chars: z.number().int().positive().optional(),
        model: z.string().optional(),
        focus_on: z.array(z.string()).optional(),
      })
      .optional(),
    retention: z.record(z.any()).optional(),
  })
  .passthrough();

export type StateManagementConfig = z.infer<typeof StateManagementConfigSchema>;

// ---------------------------------------------------------------------------
// Ralph (autonomous loop) config
// ---------------------------------------------------------------------------

export const RalphConfigSchema = z
  .object({
    max_steps: z.number().int().positive().optional(),
    timeout: z.number().positive().optional(),
    verify_command: z.string().optional(),
    use_critic: z.boolean().optional(),
    critic_mode: z.enum(['light', 'heavy']).optional(),
  })
  .passthrough();

export type RalphConfig = z.infer<typeof RalphConfigSchema>;

// ---------------------------------------------------------------------------
// System config
// ---------------------------------------------------------------------------

export const SystemConfigSchema = z
  .object({
    name: z.string().optional(),
    version: z.string().optional(),
    workspace_root: z.string().optional(),
    default_language: z.string().optional(),
    log_level: z.string().optional(),
    max_steps: z.number().int().positive().optional(),
    max_format_errors: z.number().int().positive().optional(),
    max_tool_errors: z.number().int().positive().optional(),
  })
  .passthrough();

export type SystemConfig = z.infer<typeof SystemConfigSchema>;

// ---------------------------------------------------------------------------
// Context compression config
// ---------------------------------------------------------------------------

export const ContextCompressionConfigSchema = z
  .object({
    event_max_chars: z.number().int().nonnegative().optional(),
    event_min_count_threshold: z.number().int().nonnegative().optional(),
    summary_trim_step: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export type ContextCompressionConfig = z.infer<
  typeof ContextCompressionConfigSchema
>;

// ---------------------------------------------------------------------------
// Sense / Hints config
// ---------------------------------------------------------------------------

export const HintsConfigSchema = z
  .object({
    auto_inject_readme: z.boolean().optional(),
    scan_dot_hint_files: z.boolean().optional(),
    include_error_traceback: z.boolean().optional(),
    max_hint_chars: z.number().int().positive().optional(),
    max_file_chars: z.number().int().positive().optional(),
    ignore_list: z.array(z.string()).optional(),
  })
  .passthrough();

export type HintsConfig = z.infer<typeof HintsConfigSchema>;

// ---------------------------------------------------------------------------
// Embedding config
// ---------------------------------------------------------------------------

export const EmbeddingConfigSchema = z
  .object({
    provider: z.string().optional(),
    model: z.string().optional(),
    api_base: z.string().optional(),
    api_key_env: z.string().optional(),
  })
  .passthrough();

export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;

// ---------------------------------------------------------------------------
// Image Generation config
// ---------------------------------------------------------------------------

export const ImageGenerationConfigSchema = z
  .object({
    provider: z.string().optional(),
    model: z.string().optional(),
    size: z.string().optional(),
    api_key_env: z.string().optional(),
  })
  .passthrough();

export type ImageGenerationConfig = z.infer<typeof ImageGenerationConfigSchema>;

// ---------------------------------------------------------------------------
// Knowledge DB config
// ---------------------------------------------------------------------------

export const KnowledgeDbConfigSchema = z
  .object({
    storage: z.string().optional(),
  })
  .passthrough();

export type KnowledgeDbConfig = z.infer<typeof KnowledgeDbConfigSchema>;

// ---------------------------------------------------------------------------
// Root config
// ---------------------------------------------------------------------------

export const AuraConfigSchema = z
  .object({
    system: SystemConfigSchema.optional(),
    llm: LLMConfigSchema.optional(),
    tool_protocol: ToolProtocolConfigSchema.optional(),
    security: SecurityConfigSchema.optional(),
    state_management: StateManagementConfigSchema.optional(),
    context_compression: ContextCompressionConfigSchema.optional(),
    ralph: RalphConfigSchema.optional(),
    hints: HintsConfigSchema.optional(),
    embedding: EmbeddingConfigSchema.optional(),
    image_generation: ImageGenerationConfigSchema.optional(),
    knowledge_db: KnowledgeDbConfigSchema.optional(),
  })
  .passthrough();

export type AuraConfig = z.infer<typeof AuraConfigSchema>;

// ---------------------------------------------------------------------------
// Helper: parse with fallback to empty defaults
// ---------------------------------------------------------------------------

/**
 * Safely parses a raw YAML object into a validated AuraConfig.
 * On validation failure, logs warnings and returns partial defaults rather than throwing.
 */
export function parseAuraConfig(raw: unknown): AuraConfig {
  const result = AuraConfigSchema.safeParse(raw ?? {});
  if (!result.success) {
    // Log validation issues but don't crash — config may have extra/unknown keys
    const issues = result.error.issues.filter(
      (i) => i.code !== 'unrecognized_keys',
    );
    if (issues.length > 0 && process.env.AURA_SILENCE_CONFIG_WARNINGS !== '1') {
      console.warn(
        '[ConfigSchema] Config validation issues:',
        issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '),
      );
    }
    // Return best-effort parse with defaults
    return AuraConfigSchema.parse({});
  }
  return result.data;
}

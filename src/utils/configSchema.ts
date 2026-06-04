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

const FallbackProviderSchema = z.object({
  provider:    z.string().min(1),
  api_base:    z.string().optional(),
  api_key:     z.string().optional(),
  api_key_env: z.string().optional(),
  model:       z.string().optional(),
  max_retries: z.number().int().nonnegative().optional(),
}).passthrough();

export const LLMConfigSchema = z.object({
  provider:    z.string().default('local'),
  api_base:    z.string().optional(),
  api_key:     z.string().optional(),
  api_key_env: z.string().optional(),
  model:       z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens:  z.number().int().positive().optional(),
  max_retries: z.number().int().nonnegative().optional(),
  fallbacks:   z.array(FallbackProviderSchema).default([]),
  /** Legacy singular backup key */
  backup:      FallbackProviderSchema.optional(),
}).passthrough();

export type LLMConfig = z.infer<typeof LLMConfigSchema>;

// ---------------------------------------------------------------------------
// Tool protocol config
// ---------------------------------------------------------------------------

const CallOutputSchema = z.object({
  max_chars:  z.number().int().positive().optional(),
  head_ratio: z.number().min(0).max(1).optional(),
}).passthrough();

const BashProtocolSchema = z.object({
  base_wait_seconds: z.number().positive().optional(),
}).passthrough();

export const ToolProtocolConfigSchema = z.object({
  default_timeout_seconds:    z.number().positive().default(300),
  max_timeout_seconds:        z.number().positive().default(1200),
  agent_can_modify_timeout:   z.boolean().default(true),
  runtimes:                   z.record(z.string()).default({}),
  call_output:                CallOutputSchema.optional(),
  bash:                       BashProtocolSchema.optional(),
  call_summary:               z.object({ max_chars: z.number().int().positive().optional() }).optional(),
}).passthrough();

export type ToolProtocolConfig = z.infer<typeof ToolProtocolConfigSchema>;

// ---------------------------------------------------------------------------
// Security config
// ---------------------------------------------------------------------------

export const SecurityConfigSchema = z.object({
  strict_path_isolation:  z.boolean().default(false),
  forbidden_extensions:   z.array(z.string()).default([]),
  read_only_directories:  z.array(z.string()).default([]),
  git_snapshots:          z.boolean().default(false),
  sandbox: z.object({
    enabled:  z.boolean().default(false),
    provider: z.enum(['docker', 'local']).optional(),
    image:    z.string().optional(),
  }).optional(),
}).passthrough();

export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

// ---------------------------------------------------------------------------
// State management / memory config
// ---------------------------------------------------------------------------

export const StateManagementConfigSchema = z.object({
  max_events:           z.number().int().positive().optional(),
  summary_threshold:    z.number().int().positive().optional(),
  summarize_on_start:   z.boolean().optional(),
  keep_recent:          z.number().int().positive().optional(),
}).passthrough();

export type StateManagementConfig = z.infer<typeof StateManagementConfigSchema>;

// ---------------------------------------------------------------------------
// Ralph (autonomous loop) config
// ---------------------------------------------------------------------------

export const RalphConfigSchema = z.object({
  max_steps:       z.number().int().positive().optional(),
  timeout:         z.number().positive().optional(),
  verify_command:  z.string().optional(),
  use_critic:      z.boolean().optional(),
  critic_mode:     z.enum(['light', 'heavy']).optional(),
}).passthrough();

export type RalphConfig = z.infer<typeof RalphConfigSchema>;

// ---------------------------------------------------------------------------
// System config
// ---------------------------------------------------------------------------

export const SystemConfigSchema = z.object({
  max_steps:         z.number().int().positive().optional(),
  max_format_errors: z.number().int().positive().optional(),
  max_tool_errors:   z.number().int().positive().optional(),
}).passthrough();

export type SystemConfig = z.infer<typeof SystemConfigSchema>;

// ---------------------------------------------------------------------------
// Context compression config
// ---------------------------------------------------------------------------

export const ContextCompressionConfigSchema = z.object({
  event_max_chars:            z.number().int().nonnegative().optional(),
  event_min_count_threshold:  z.number().int().nonnegative().optional(),
  summary_trim_step:          z.number().int().nonnegative().optional(),
}).passthrough();

export type ContextCompressionConfig = z.infer<typeof ContextCompressionConfigSchema>;

// ---------------------------------------------------------------------------
// Root config
// ---------------------------------------------------------------------------

export const AuraConfigSchema = z.object({
  llm:              LLMConfigSchema.optional(),
  tool_protocol:    ToolProtocolConfigSchema.optional(),
  security:         SecurityConfigSchema.optional(),
  state_management: StateManagementConfigSchema.optional(),
  context_compression: ContextCompressionConfigSchema.optional(),
  ralph:            RalphConfigSchema.optional(),
  system:           SystemConfigSchema.optional(),
}).passthrough();

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
      (i) => i.code !== 'unrecognized_keys'
    );
    if (issues.length > 0 && process.env.AURA_SILENCE_CONFIG_WARNINGS !== '1') {
      console.warn('[ConfigSchema] Config validation issues:', issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
    }
    // Return best-effort parse with defaults
    return AuraConfigSchema.parse({});
  }
  return result.data;
}

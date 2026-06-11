/**
 * Shared configuration type definitions for Aura CLI.
 * These interfaces represent the structure of .aura/config.yml.
 */

export interface LlmConfig {
  provider?: string;
  model?: string;
  api_base?: string;
  api_key?: string;
  /** Environment variable name to read the API key from */
  api_key_env?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface HintsConfig {
  auto_inject_readme?: boolean;
  ignore_list?: string[];
  custom_files?: string[];
}

export interface RalphConfig {
  max_steps?: number;
  verify_command?: string;
  critic?: boolean;
  critic_mode?: 'light' | 'strict';
}

export interface StateManagementConfig {
  backend?: string;
  [key: string]: unknown;
}

export interface SecurityConfig {
  confirm_dangerous_tools?: boolean;
}

/**
 * Top-level structure of .aura/config.yml
 */
export interface AuraConfig {
  project_name?: string;
  llm?: LlmConfig;
  hints?: HintsConfig;
  ralph?: RalphConfig;
  state_management?: StateManagementConfig;
  security?: SecurityConfig;
  verbose?: boolean;
  [key: string]: unknown;
}

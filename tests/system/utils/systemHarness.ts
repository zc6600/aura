import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { type ExecaReturnValue, execa } from 'execa';
import yaml from 'yaml';
import { initializeWorkspaceInPlace } from '../../../src/utils/workspaceInitializer.js';
import { rmRetry } from '../../utils/rmRetry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const systemDir = path.resolve(__dirname, '..');

loadDotenv({ path: path.join(systemDir, '.env'), override: false });
loadDotenv({ path: path.join(systemDir, '.env.local'), override: false });

export const auraBinPath = path.resolve(__dirname, '../../../src/bin/aura.ts');
export const runSystemTests = process.env.RUN_SYSTEM_TESTS === '1';

export interface SystemLlmConfig {
  provider: string;
  model?: string;
  apiBase?: string;
  apiKeyEnv: string;
}

export interface SystemWorkspace {
  root: string;
  auraDir: string;
  configPath: string;
  cleanup: () => Promise<void>;
}

export function resolveSystemLlmConfig(): SystemLlmConfig | null {
  const explicitProvider = process.env.AURA_SYSTEM_LLM_PROVIDER;
  const explicitKeyEnv = process.env.AURA_SYSTEM_LLM_API_KEY_ENV;

  if (explicitProvider && explicitKeyEnv && process.env[explicitKeyEnv]) {
    return {
      provider: explicitProvider,
      model: process.env.AURA_SYSTEM_LLM_MODEL,
      apiBase: process.env.AURA_SYSTEM_LLM_API_BASE,
      apiKeyEnv: explicitKeyEnv,
    };
  }

  const candidates: Array<Pick<SystemLlmConfig, 'provider' | 'apiKeyEnv'>> = [
    { provider: 'openrouter', apiKeyEnv: 'OPENROUTER_API_KEY' },
    { provider: 'openai', apiKeyEnv: 'OPENAI_API_KEY' },
    { provider: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' },
    { provider: 'deepseek', apiKeyEnv: 'DEEPSEEK_API_KEY' },
    { provider: 'gemini', apiKeyEnv: 'GEMINI_API_KEY' },
  ];

  const detected = candidates.find(({ apiKeyEnv }) => {
    return !!process.env[apiKeyEnv]?.trim();
  });

  if (!detected) return null;

  return {
    ...detected,
    model: process.env.AURA_SYSTEM_LLM_MODEL,
    apiBase: process.env.AURA_SYSTEM_LLM_API_BASE,
  };
}

export function requireSystemLlmConfig(): SystemLlmConfig {
  const config = resolveSystemLlmConfig();
  if (!config) {
    throw new Error(
      'RUN_SYSTEM_TESTS=1 requires a real LLM key. Set OPENROUTER_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, DEEPSEEK_API_KEY, GEMINI_API_KEY, or AURA_SYSTEM_LLM_PROVIDER + AURA_SYSTEM_LLM_API_KEY_ENV.',
    );
  }
  return config;
}

export async function createSystemWorkspace(
  prefix: string,
  llmConfig: SystemLlmConfig = requireSystemLlmConfig(),
): Promise<SystemWorkspace> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `aura-system-${prefix}-`));
  await initializeWorkspaceInPlace(root);

  const auraDir = path.join(root, '.aura');
  const configPath = path.join(auraDir, 'config', 'config.yml');
  const rawConfig = yaml.parse(fs.readFileSync(configPath, 'utf-8')) || {};

  rawConfig.llm = {
    ...(rawConfig.llm || {}),
    provider: llmConfig.provider,
    model: llmConfig.model || rawConfig.llm?.model,
    api_base: llmConfig.apiBase || rawConfig.llm?.api_base || undefined,
    api_key_env: llmConfig.apiKeyEnv,
    temperature: Number(process.env.AURA_SYSTEM_LLM_TEMPERATURE ?? 0),
    max_tokens: Number(process.env.AURA_SYSTEM_LLM_MAX_TOKENS ?? 1024),
    max_retries: Number(process.env.AURA_SYSTEM_LLM_MAX_RETRIES ?? 0),
  };

  rawConfig.system = {
    ...(rawConfig.system || {}),
    max_steps: Number(process.env.AURA_SYSTEM_MAX_STEPS ?? 4),
    max_format_errors: 2,
    max_tool_errors: 2,
  };

  fs.writeFileSync(configPath, yaml.stringify(rawConfig), 'utf-8');

  return {
    root,
    auraDir,
    configPath,
    cleanup: async () => {
      if (fs.existsSync(root)) {
        await rmRetry(root);
      }
    },
  };
}

export async function runAura(
  workspace: SystemWorkspace,
  args: string[],
  options: {
    timeout?: number;
    reject?: boolean;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<ExecaReturnValue<string>> {
  return execa('npx', ['tsx', auraBinPath, ...args], {
    cwd: workspace.root,
    timeout: options.timeout ?? 90_000,
    reject: options.reject ?? false,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AURA_SILENCE_LLM_WARNINGS: '1',
      AURA_SILENCE_PLANNER_WARNINGS: '1',
      ...options.env,
    },
  });
}

export function parseJsonOutput<T = Record<string, unknown>>(
  stdout: string,
): T {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Expected JSON object in stdout, got: ${stdout}`);
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as T;
}

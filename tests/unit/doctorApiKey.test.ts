import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the Doctor API-key validation logic.
 *
 * We test the invariant that was changed:
 *   - doctor ONLY reads the API key from environment variables (process.env)
 *   - doctor does NOT accept llm.api_key stored directly in config.yml
 */

// Inline the apiKeySet logic extracted from doctor.ts so we can test it
// in isolation without spinning up the full CLI.
function getEnvVarName(provider: string): string | null {
  switch (provider.toLowerCase()) {
    case 'openai':      return 'OPENAI_API_KEY';
    case 'openrouter':  return 'OPENROUTER_API_KEY';
    case 'anthropic':   return 'ANTHROPIC_API_KEY';
    case 'gemini':      return 'GEMINI_API_KEY';
    case 'deepseek':    return 'DEEPSEEK_API_KEY';
    default:            return null;
  }
}

/** Mirror of the apiKeySet logic currently in doctor.ts */
function isApiKeySet(
  provider: string,
  llmCfg: Record<string, unknown>,
): boolean {
  const envVarName = getEnvVarName(provider);
  // Must come from env var — llmCfg.api_key is intentionally NOT accepted.
  return !!(envVarName && process.env[envVarName]?.trim());
}

describe('Doctor API-key validation (env-only policy)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore any env vars modified during the test
    for (const key of [
      'GEMINI_API_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENROUTER_API_KEY',
      'DEEPSEEK_API_KEY',
    ]) {
      if (key in originalEnv) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('returns true when the matching env var is set', () => {
    process.env.GEMINI_API_KEY = 'sk-test-123';
    expect(isApiKeySet('gemini', {})).toBe(true);
  });

  it('returns false when env var is missing — even if config.yml has api_key', () => {
    delete process.env.GEMINI_API_KEY;
    // Simulate a config that (wrongly) contains an inline api_key
    const llmCfg = { provider: 'gemini', api_key: 'leaked-key' };
    expect(isApiKeySet('gemini', llmCfg)).toBe(false);
  });

  it('returns false when env var is empty string', () => {
    process.env.GEMINI_API_KEY = '   ';
    expect(isApiKeySet('gemini', {})).toBe(false);
  });

  it('handles all supported providers', () => {
    const cases: [string, string][] = [
      ['openai',      'OPENAI_API_KEY'],
      ['openrouter',  'OPENROUTER_API_KEY'],
      ['anthropic',   'ANTHROPIC_API_KEY'],
      ['gemini',      'GEMINI_API_KEY'],
      ['deepseek',    'DEEPSEEK_API_KEY'],
    ];

    for (const [provider, envVar] of cases) {
      delete process.env[envVar];
      expect(isApiKeySet(provider, {})).toBe(false);

      process.env[envVar] = 'test-key';
      expect(isApiKeySet(provider, {})).toBe(true);

      delete process.env[envVar];
    }
  });

  it('returns false for an unknown provider (no matching env var)', () => {
    expect(isApiKeySet('unknown_provider', { api_key: 'secret' })).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Integration-style test: verify the full doctor.loadDotenvFiles() reads
// ~/.aura-framework/.env correctly (not cli-src/.env or any other path).
// --------------------------------------------------------------------------
describe('Doctor.loadDotenvFiles — global .env path', () => {
  const globalEnvPath = path.join(os.homedir(), '.aura-framework', '.env');
  const TEST_KEY = 'DOCTOR_INTEG_TEST_KEY_XYZ';

  afterEach(() => {
    delete process.env[TEST_KEY];
    // Remove the test key from the file if we wrote it
    if (fs.existsSync(globalEnvPath)) {
      const content = fs.readFileSync(globalEnvPath, 'utf-8');
      const cleaned = content
        .split('\n')
        .filter((l) => !l.startsWith(TEST_KEY))
        .join('\n');
      fs.writeFileSync(globalEnvPath, cleaned, 'utf-8');
    }
  });

  it('reads keys from ~/.aura-framework/.env', async () => {
    // Ensure the directory exists
    fs.mkdirSync(path.dirname(globalEnvPath), { recursive: true });

    // Append our test key
    fs.appendFileSync(globalEnvPath, `\n${TEST_KEY}=hello_from_global\n`);

    // Clear any cached value
    delete process.env[TEST_KEY];

    const { Doctor } = await import('../../src/cli/commands/doctor.js');
    Doctor.loadDotenvFiles();

    expect(process.env[TEST_KEY]).toBe('hello_from_global');
  });
});


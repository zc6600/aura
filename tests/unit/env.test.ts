import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Env from '../../src/core/llm/env.js';

describe('LLM Env Loader', () => {
  const tempDir = path.resolve(__dirname, 'temp-env-test');
  const envPath = path.join(tempDir, '.env');

  beforeAll(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    // Clean up process.env modifications
    delete process.env.TEST_PROVIDER_API_KEY;
    delete process.env.AURA_LLM_API_KEY;
  });

  it('should parse key values and strip comments/export correctly', () => {
    const content = `
      # This is a comment
      TEST_VAR=hello # inline comment
      export TEST_VAR2="world" # double quotes comment
      TEST_VAR3='single-quoted'
      # Export with spacing
      export   TEST_VAR4 = value-with-spaces  
    `;

    fs.writeFileSync(envPath, content);
    Env.loadFile(envPath);

    expect(process.env.TEST_VAR).toBe('hello');
    expect(process.env.TEST_VAR2).toBe('world');
    expect(process.env.TEST_VAR3).toBe('single-quoted');
    expect(process.env.TEST_VAR4).toBe('value-with-spaces');

    // Clean up
    delete process.env.TEST_VAR;
    delete process.env.TEST_VAR2;
    delete process.env.TEST_VAR3;
    delete process.env.TEST_VAR4;
  });

  it('should resolve provider keys with fallbacks', () => {
    process.env.TEST_PROVIDER_API_KEY = 'provider-key-123';
    process.env.AURA_LLM_API_KEY = 'general-key-456';
    process.env.OPENROUTER_API_KEY = 'sk-openrouter';
    process.env.AZURE_OPENAI_API_KEY = 'sk-azure';

    // Provider specific match
    expect(Env.resolveApiKey('test_provider')).toBe('provider-key-123');

    // Vendor specific precedence
    expect(Env.resolveApiKey('openrouter')).toBe('sk-openrouter');

    // Fallback to general AURA key
    expect(Env.resolveApiKey('mistral')).toBe('general-key-456');

    // Provider name normalization
    expect(Env.resolveApiKey('azure_openai')).toBe('sk-azure');

    // Special characters and empty input
    process.env.OPENAI_GPT_4_API_KEY = 'sk-gpt4';
    expect(Env.resolveApiKey('openai/gpt-4')).toBe('sk-gpt4');
    expect(Env.resolveApiKey('OpenAI-GPT-4')).toBe('sk-gpt4');
    expect(Env.resolveApiKey('')).toBe('general-key-456');

    // Clean up
    delete process.env.TEST_PROVIDER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.AZURE_OPENAI_API_KEY;
    delete process.env.OPENAI_GPT_4_API_KEY;
  });
});

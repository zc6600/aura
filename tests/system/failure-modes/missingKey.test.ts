import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSystemWorkspace,
  runAura,
  runSystemTests,
  type SystemWorkspace,
} from '../utils/systemHarness.js';

const describeSystem = runSystemTests ? describe : describe.skip;

describeSystem('System resilience', { timeout: 60000 }, () => {
  let workspace: SystemWorkspace;

  beforeEach(async () => {
    workspace = await createSystemWorkspace('missing-key', {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKeyEnv: 'AURA_SYSTEM_TEST_MISSING_KEY',
    });
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it('fails clearly when the configured real provider has no API key', async () => {
    const result = await runAura(
      workspace,
      ['chat', 'This should fail before any successful LLM response.'],
      {
        env: {
          AURA_SYSTEM_TEST_MISSING_KEY: '',
          OPENAI_API_KEY: '',
          AURA_LLM_API_KEY: '',
        },
      },
    );

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/missing api key/i);
  });
});

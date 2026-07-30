import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSystemWorkspace,
  readSessionTranscript,
  requireSystemLlmConfig,
  runAura,
  runSystemTests,
  type SystemWorkspace,
  sessionDbPath,
} from '../utils/systemHarness.js';

const describeSystem = runSystemTests ? describe : describe.skip;

describeSystem('System LLM smoke', { timeout: 120000 }, () => {
  let workspace: SystemWorkspace;

  beforeEach(async () => {
    workspace = await createSystemWorkspace(
      'llm-smoke',
      requireSystemLlmConfig(),
    );
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it('completes one real chat turn and persists chat history', async () => {
    const result = await runAura(workspace, [
      'chat',
      'Reply with a short acknowledgement for a system smoke test.',
      '--system',
      'Keep the answer under 12 words.',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
    expect(result.stderr).not.toContain('Error calling LLM');

    expect(fs.existsSync(sessionDbPath(workspace))).toBe(true);

    const history = readSessionTranscript(workspace);
    expect(history.at(-2)?.role).toBe('user');
    expect(history.at(-1)?.role).toBe('assistant');
    expect(history.at(-1)?.content.trim().length).toBeGreaterThan(0);
  });
});

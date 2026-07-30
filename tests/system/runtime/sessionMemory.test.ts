import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSystemWorkspace,
  readSessionTranscript,
  requireSystemLlmConfig,
  runAura,
  runSystemTests,
  type SystemWorkspace,
} from '../utils/systemHarness.js';

const describeSystem = runSystemTests ? describe : describe.skip;

describeSystem('System session memory', { timeout: 180000 }, () => {
  let workspace: SystemWorkspace;

  beforeEach(async () => {
    workspace = await createSystemWorkspace(
      'session-memory',
      requireSystemLlmConfig(),
    );
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it('persists chat turns and provides them to a later turn', async () => {
    const token = `AURA_MEMORY_${Date.now()}`;
    const session = 'system_memory';

    const first = await runAura(workspace, [
      'chat',
      `Remember this token for the next turn: ${token}`,
      '--session',
      session,
      '--system',
      'Acknowledge briefly.',
    ]);
    expect(first.exitCode).toBe(0);

    const second = await runAura(workspace, [
      'chat',
      'What token did I ask you to remember? Reply with only the token if possible.',
      '--session',
      session,
    ]);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain(token);

    const history = readSessionTranscript(workspace, session);
    expect(history.length).toBeGreaterThanOrEqual(4);
    expect(history.filter((item) => item.role === 'user')).toHaveLength(2);
    expect(history.filter((item) => item.role === 'assistant')).toHaveLength(2);
  });

  it('keeps remembered content isolated between sessions', async () => {
    const token = `AURA_ISOLATED_MEMORY_${Date.now()}`;
    const sourceSession = 'memory_source';
    const isolatedSession = 'memory_isolated';

    const source = await runAura(workspace, [
      'chat',
      `Remember this token for later in this session only: ${token}`,
      '--session',
      sourceSession,
      '--system',
      'Acknowledge briefly.',
    ]);
    expect(source.exitCode).toBe(0);

    const isolated = await runAura(workspace, [
      'chat',
      'What token did I ask you to remember earlier? If this session has no token, reply with UNKNOWN only.',
      '--session',
      isolatedSession,
      '--system',
      'Reply with UNKNOWN if the token is unavailable in this session.',
    ]);
    expect(isolated.exitCode).toBe(0);
    expect(isolated.stdout).not.toContain(token);
    expect(isolated.stdout).toMatch(/UNKNOWN/i);

    expect(
      JSON.stringify(readSessionTranscript(workspace, sourceSession)),
    ).toContain(token);
    expect(
      JSON.stringify(readSessionTranscript(workspace, isolatedSession)),
    ).not.toContain(token);
  });
});

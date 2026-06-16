import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSystemWorkspace,
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

    const historyPath = path.join(
      workspace.auraDir,
      'state',
      'chat_sessions',
      `${session}.json`,
    );
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8')) as Array<{
      role: string;
      content: string;
    }>;
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

    const sourceHistoryPath = path.join(
      workspace.auraDir,
      'state',
      'chat_sessions',
      `${sourceSession}.json`,
    );
    const isolatedHistoryPath = path.join(
      workspace.auraDir,
      'state',
      'chat_sessions',
      `${isolatedSession}.json`,
    );

    expect(fs.readFileSync(sourceHistoryPath, 'utf-8')).toContain(token);
    expect(fs.readFileSync(isolatedHistoryPath, 'utf-8')).not.toContain(token);
  });
});

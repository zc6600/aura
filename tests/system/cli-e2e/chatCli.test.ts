import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MemoryProvider,
  type TranscriptMessage,
} from '../../../src/core/memory/provider.js';
import { SQLiteStore } from '../../../src/core/memory/sqliteStore.js';
import {
  createSystemWorkspace,
  runAura,
  runSystemTests,
  type SystemWorkspace,
} from '../utils/systemHarness.js';

const describeSystem = runSystemTests ? describe : describe.skip;

function sessionDbPath(workspace: SystemWorkspace, session: string): string {
  return path.join(workspace.auraDir, 'state', 'sessions', `${session}.db`);
}

/** Chat history now lives in the session event log, not a flat JSON file. */
function readTranscript(dbPath: string): TranscriptMessage[] {
  const store = new SQLiteStore({ dbPath });
  try {
    return new MemoryProvider(store).toChatMessages();
  } finally {
    store.close();
  }
}

describeSystem('System chat CLI', { timeout: 180000 }, () => {
  let workspace: SystemWorkspace;

  beforeEach(async () => {
    workspace = await createSystemWorkspace('chat-cli');
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it('clears a named chat session before answering the next turn', async () => {
    const token = `AURA_CHAT_CLEAR_${Date.now()}`;
    const session = 'chat_clear';

    const first = await runAura(workspace, [
      'chat',
      `Remember this token for later in this session only: ${token}`,
      '--session',
      session,
      '--system',
      'Acknowledge briefly.',
    ]);
    expect(first.exitCode).toBe(0);

    const cleared = await runAura(workspace, [
      'chat',
      'What token did I ask you to remember earlier? If none is available in this session, reply with UNKNOWN only.',
      '--session',
      session,
      '--clear',
      '--system',
      'Reply with UNKNOWN only when the current session has no remembered token.',
    ]);
    expect(cleared.exitCode).toBe(0);
    expect(cleared.stdout).toContain(
      `Memory cleared for session '${session}'.`,
    );
    expect(cleared.stdout).not.toContain(token);
    expect(cleared.stdout).toMatch(/UNKNOWN/i);

    const dbPath = sessionDbPath(workspace, session);
    expect(fs.existsSync(dbPath)).toBe(true);

    const history = readTranscript(dbPath);
    expect(history).toHaveLength(2);
    expect(history.at(0)?.role).toBe('user');
    expect(history.at(1)?.role).toBe('assistant');
    expect(JSON.stringify(history)).not.toContain(token);
  });

  it('prints session history through the chat context command for a named session', async () => {
    const session = 'chat_context';
    const prompt = 'Reply with a short acknowledgement for chat history.';

    const first = await runAura(workspace, [
      'chat',
      prompt,
      '--session',
      session,
      '--system',
      'Keep the answer under 10 words.',
    ]);
    expect(first.exitCode).toBe(0);

    const context = await runAura(workspace, [
      'chat',
      'context',
      '--session',
      session,
    ]);
    expect(context.exitCode).toBe(0);
    expect(context.stdout).toContain(
      `Conversation history for session '${session}':`,
    );
    expect(context.stdout).toContain(prompt);
  });

  it('fails clearly for an invalid provider override without persisting chat history', async () => {
    const session = 'chat_invalid_provider';
    const dbPath = sessionDbPath(workspace, session);

    const result = await runAura(workspace, [
      'chat',
      'Reply with a short greeting.',
      '--session',
      session,
      '--provider',
      'definitely-not-a-real-provider',
      '--model',
      'invalid-model',
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/Error calling LLM/i);
    // A failed turn must not even bring the session database into existence.
    expect(fs.existsSync(dbPath)).toBe(false);
  });
});

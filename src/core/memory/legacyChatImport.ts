import fs from 'node:fs';
import path from 'node:path';
import { MemoryRecorder } from './recorder.js';
import type { SQLiteStore } from './sqliteStore.js';

const LEGACY_DIR = 'chat_sessions';
const MIGRATED_SUFFIX = '.migrated';

interface LegacyMessage {
  role?: unknown;
  content?: unknown;
}

export interface LegacyImportResult {
  imported: number;
  /** Set when a legacy file was found but deliberately left in place. */
  skippedReason?: 'session-not-empty' | 'unreadable';
  legacyPath?: string;
}

export function legacyChatHistoryPath(
  stateDir: string,
  sessionName: string,
): string {
  return path.join(stateDir, LEGACY_DIR, `${sessionName}.json`);
}

/**
 * One-shot import of a pre-unification `state/chat_sessions/<name>.json`
 * transcript into the session's SQLite event log.
 *
 * `aura chat` used to keep its own flat JSON history, separate from the event
 * log every other execution path writes to. Both now share one store, so any
 * leftover JSON has to be folded in before the session is read — otherwise a
 * user's chat history would simply vanish on upgrade.
 *
 * Import is skipped when the target session already holds events: that means
 * something has written to it since, and replaying old turns would interleave
 * them at the wrong point in the timeline. The file is left untouched in that
 * case so it can still be recovered by hand.
 */
export function importLegacyChatHistory(
  store: SQLiteStore,
  stateDir: string,
  sessionName: string,
): LegacyImportResult {
  const legacyPath = legacyChatHistoryPath(stateDir, sessionName);
  if (!fs.existsSync(legacyPath)) {
    return { imported: 0 };
  }

  if (store.countEvents() > 0) {
    return { imported: 0, skippedReason: 'session-not-empty', legacyPath };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
  } catch {
    return { imported: 0, skippedReason: 'unreadable', legacyPath };
  }

  if (!Array.isArray(parsed)) {
    return { imported: 0, skippedReason: 'unreadable', legacyPath };
  }

  const events: Record<string, unknown>[] = [];
  for (const entry of parsed as LegacyMessage[]) {
    if (!entry || typeof entry !== 'object') continue;
    const role = String(entry.role ?? '');
    const content = String(entry.content ?? '');
    if (content.trim().length === 0) continue;
    // Legacy histories only ever held user/assistant pairs; anything else
    // (a stray system row) is dropped rather than guessed at.
    if (role !== 'user' && role !== 'assistant') continue;
    events.push({ type: role, content });
  }

  if (events.length > 0) {
    new MemoryRecorder(store).recordBatch(events);
  }

  try {
    fs.renameSync(legacyPath, `${legacyPath}${MIGRATED_SUFFIX}`);
  } catch {
    // Import already succeeded; a failed rename only means we re-check next
    // run, and countEvents() will short-circuit it.
  }

  return { imported: events.length, legacyPath };
}

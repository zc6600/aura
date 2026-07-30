import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryProvider } from '../../src/core/memory/provider.js';
import { MemoryRecorder } from '../../src/core/memory/recorder.js';
import { SQLiteStore } from '../../src/core/memory/sqliteStore.js';

// Regression coverage for the toMarkdown() ordering bug: a single user turn
// with multiple tool calls used to give every Tool Result/Summary pair the
// same sort key (call_seq pinned to the turn's user event), so the sort's
// `order` tiebreaker bunched all Tool Results before all Summaries instead
// of interleaving them chronologically.
describe('MemoryProvider.toMarkdown ordering', () => {
  let tempDir: string;
  let store: SQLiteStore;
  let recorder: MemoryRecorder;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-provider-order-'));
    store = new SQLiteStore({
      dbPath: path.join(tempDir, 'state', 'sessions', 'default.db'),
    });
    recorder = new MemoryRecorder(store);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function historyLines(): string[] {
    const md = new MemoryProvider(store).toMarkdown();
    const historyIdx = md.indexOf('### History:');
    const history = historyIdx >= 0 ? md.slice(historyIdx) : '';
    return history
      .split('\n')
      .filter((l) => l.trim().startsWith('- '))
      .map((l) => l.replace(/^- (\[[^\]]+\] )?/, ''));
  }

  it('interleaves each tool call with its own summary across a multi-call turn', () => {
    recorder.recordUser('do three things');

    // Mirrors Runner.runCall: each tool call's summary is anchored to that
    // specific execution's own event id, so a turn with several tool calls
    // still produces distinct, correctly ordered seq values instead of
    // every pair colliding on one shared key.
    for (let i = 1; i <= 3; i++) {
      const eventId = recorder.recordExecution(`tool${i}`, {
        status: 'ok',
        output: `result${i}`,
      });
      recorder.recordSummary(`did step ${i}`, eventId);
    }

    const lines = historyLines();
    const toolAndSummaryLines = lines.filter(
      (l) => l.startsWith('Tool ') || l.startsWith('Summary:'),
    );

    expect(toolAndSummaryLines).toEqual([
      'Tool tool1: ok - result1',
      'Summary: did step 1',
      'Tool tool2: ok - result2',
      'Summary: did step 2',
      'Tool tool3: ok - result3',
      'Summary: did step 3',
    ]);
  });

  it('does not let a legacy summary with no source_event_id corrupt unrelated ordering', () => {
    recorder.recordUser('turn one');
    const e1 = recorder.recordExecution('toolA', {
      status: 'ok',
      output: 'a',
    });
    recorder.recordSummary('summary for A', e1);

    // Simulates a pre-migration row: source_event_id was never backfilled,
    // so it's NULL in the DB, and summaries.id (its own unrelated counter)
    // must not be used as a stand-in for an events-table position.
    store.insertSummary({ content: 'orphaned legacy summary' });

    const e2 = recorder.recordExecution('toolB', {
      status: 'ok',
      output: 'b',
    });
    recorder.recordSummary('summary for B', e2);

    const lines = historyLines();
    const aIdx = lines.indexOf('Tool toolA: ok - a');
    const summaryAIdx = lines.indexOf('Summary: summary for A');
    const bIdx = lines.indexOf('Tool toolB: ok - b');
    const summaryBIdx = lines.indexOf('Summary: summary for B');
    const orphanIdx = lines.indexOf('Summary: orphaned legacy summary');

    expect([aIdx, summaryAIdx, bIdx, summaryBIdx, orphanIdx]).not.toContain(-1);
    // The orphaned summary (seq falls back to 0) sorts before everything
    // else rather than landing between A and B based on an unrelated id.
    expect(orphanIdx).toBeLessThan(aIdx);
    // A's call and summary stay paired, and B's call and summary stay
    // paired, in true chronological order.
    expect(aIdx).toBeLessThan(summaryAIdx);
    expect(summaryAIdx).toBeLessThan(bIdx);
    expect(bIdx).toBeLessThan(summaryBIdx);
  });
});

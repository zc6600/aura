import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Anchor } from '../../src/cli/commands/anchor.js';
import { Garden } from '../../src/cli/commands/garden.js';
import * as PathResolver from '../../src/utils/pathResolver.js';

describe('Anchor CLI command', () => {
  let tempDir = '';

  afterEach(() => {
    vi.restoreAllMocks();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('shows detailed anchor status separately from garden summary', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-anchor-command-'));
    fs.mkdirSync(path.join(tempDir, '.aura-workspace'), { recursive: true });

    const anchorsDir = path.join(tempDir, 'anchors');
    fs.mkdirSync(anchorsDir, { recursive: true });
    fs.writeFileSync(
      path.join(anchorsDir, 'ready.json'),
      JSON.stringify({
        id: 'anchor-1',
        name: 'Ready',
        description: 'Workspace is ready',
        call_when: ['step 1 complete'],
        next: ['anchor-2'],
      }),
    );
    fs.writeFileSync(
      path.join(anchorsDir, 'next.json'),
      JSON.stringify({
        id: 'anchor-2',
        call_when: ['step 2 complete'],
      }),
    );

    const dbPath = PathResolver.sessionDbPath(tempDir);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.prepare(
      'CREATE TABLE events (id INTEGER PRIMARY KEY, timestamp INTEGER, phase TEXT, tool TEXT, payload TEXT)',
    ).run();
    db.prepare(
      'INSERT INTO events (timestamp, phase, tool, payload) VALUES (?, ?, ?, ?)',
    ).run(
      Math.floor(Date.now() / 1000),
      'tool',
      'anchor_submit',
      JSON.stringify({
        anchor_id: 'anchor-1',
        summary: 'done',
        selected_next: 'anchor-2',
        runtime: {
          phase: 'waiting_guard',
          active_run_id: 'candidate_004',
          resume_action: 'retry_guard_for_same_candidate',
          tool_note: 'guard wait 900s for candidate_004',
        },
      }),
    );
    db.close();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    Anchor.status(tempDir);
    Garden.status(tempDir);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('=== Aura Anchor Status ===');
    expect(output).toContain('- anchor-1');
    expect(output).toContain('Recommended Next: anchor-2');
    expect(output).toContain('Selected Next: anchor-2');
    expect(output).toContain('Summary: done');
    expect(output).toContain('Runtime Phase: waiting_guard');
    expect(output).toContain('Active Run: candidate_004');
    expect(output).toContain('Resume Action: retry_guard_for_same_candidate');
    expect(output).toContain('=== Aura Garden Status ===');
    expect(output).toContain(
      'Details:           Use `aura anchor status` for node details.',
    );
    expect(output).not.toContain('Pending Anchors:   anchor-2');
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchorProvider } from '../../src/core/context/providers/anchorProvider.js';

describe('AnchorProvider', () => {
  let tempDir: string;
  let projectPath: string;
  let envPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'aura-test-anchor-provider-'),
    );
    projectPath = path.join(tempDir, 'project');
    envPath = path.join(tempDir, 'env');
    fs.mkdirSync(projectPath, { recursive: true });
    fs.mkdirSync(envPath, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_e) {}
  });

  it('should return null when no plan or anchors exist', () => {
    const provider = new AnchorProvider(projectPath, { envPath });
    expect(provider.provide()).toBeNull();
  });

  it('should read plan from state getVariable function', () => {
    const mockState = {
      getVariable: (key: string) => (key === 'plan' ? 'State plan text' : ''),
    };
    const provider = new AnchorProvider(projectPath, {
      envPath,
      state: mockState,
    });
    expect(provider.provide()).toContain('### Overall Task\nState plan text');
  });

  it('should read plan from state store getVariable function', () => {
    const mockState = {
      store: {
        getVariable: (key: string) => (key === 'plan' ? 'Store plan text' : ''),
      },
    };
    const provider = new AnchorProvider(projectPath, {
      envPath,
      state: mockState,
    });
    expect(provider.provide()).toContain('### Overall Task\nStore plan text');
  });

  it('should read plan from state getFirstValue function', () => {
    const mockState = {
      getFirstValue: (query: string) =>
        query.includes("WHERE key = 'plan'") ? 'SQL plan text' : '',
    };
    const provider = new AnchorProvider(projectPath, {
      envPath,
      state: mockState,
    });
    expect(provider.provide()).toContain('### Overall Task\nSQL plan text');
  });

  it('should read plan directly from SQLite database', () => {
    // Create state directory and dummy database file
    const stateDir = path.join(projectPath, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    const dbPath = path.join(stateDir, 'aura.db');

    const db = new Database(dbPath);
    db.prepare('CREATE TABLE variables (key TEXT UNIQUE, value TEXT)').run();
    db.prepare(
      "INSERT INTO variables (key, value) VALUES ('plan', 'Database plan text')",
    ).run();
    db.close();

    const provider = new AnchorProvider(projectPath, { envPath: projectPath });
    expect(provider.provide()).toContain(
      '### Overall Task\nDatabase plan text',
    );
  });

  it('should scan anchors directory and parse JSON/YAML files', () => {
    const anchorsDir = path.join(projectPath, 'anchors');
    fs.mkdirSync(anchorsDir, { recursive: true });

    // Write a JSON anchor
    fs.writeFileSync(
      path.join(anchorsDir, 'a1.json'),
      JSON.stringify({ id: 'anchor1', call_when: ['step1', 'step2'] }),
      'utf-8',
    );

    // Write a YAML anchor
    fs.writeFileSync(
      path.join(anchorsDir, 'a2.yaml'),
      `id: anchor2
call_when: step3
`,
      'utf-8',
    );

    const provider = new AnchorProvider(projectPath, { envPath });
    const result = provider.provide();
    expect(result).toContain('### Task Nodes');
    expect(result).toContain('### Anchor Submission Contract');
    expect(result).toContain(
      '- When a tool returns `anchor_runtime_update`, carry it into the next `anchor_submit` call.',
    );
    expect(result).toContain('- anchor1: step1');
    expect(result).toContain('- anchor2: step3');
  });

  it('should show current anchor focus and recommended next from latest anchor event', () => {
    const anchorsDir = path.join(projectPath, 'anchors');
    fs.mkdirSync(anchorsDir, { recursive: true });

    fs.writeFileSync(
      path.join(anchorsDir, 'a1.json'),
      JSON.stringify({
        id: 'anchor1',
        call_when: ['finish step1'],
        next: ['anchor2'],
      }),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(anchorsDir, 'a2.json'),
      JSON.stringify({
        id: 'anchor2',
        call_when: ['start step2'],
        next: ['anchor3'],
      }),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(anchorsDir, 'a3.json'),
      JSON.stringify({ id: 'anchor3', call_when: ['finish step3'] }),
      'utf-8',
    );

    const stateDir = path.join(projectPath, 'state');
    const sessionsDir = path.join(stateDir, 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'active_session.txt'), 'default');
    const dbPath = path.join(sessionsDir, 'default.db');
    const db = new Database(dbPath);
    db.prepare('CREATE TABLE variables (key TEXT UNIQUE, value TEXT)').run();
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
        anchor_id: 'anchor1',
        selected_next: 'anchor2',
        summary: 'Resume candidate_004 after guard wait.',
        notes: 'Guard cooldown hit.',
        runtime: {
          phase: 'waiting_guard',
          active_run_id: 'candidate_004',
          resume_action: 'retry_guard_for_same_candidate',
          resume_at: '2026-06-18T00:00:00Z',
          tool_note: 'guard wait 900s for candidate_004',
        },
      }),
    );
    db.close();

    const provider = new AnchorProvider(projectPath, { envPath: projectPath });
    const result = provider.provide();
    expect(result).toContain('### Anchor Progress');
    expect(result).toContain('### Anchor Submission Contract');
    expect(result).toContain('- Current anchor: anchor2: start step2');
    expect(result).toContain('- Last completed anchor: anchor1');
    expect(result).toContain('- Recommended next anchor: anchor2');
    expect(result).toContain('### Anchor Runtime');
    expect(result).toContain(
      '- Agent summary: Resume candidate_004 after guard wait.',
    );
    expect(result).toContain('- Phase: waiting_guard');
    expect(result).toContain('- Active run: candidate_004');
    expect(result).toContain('- Resume action: retry_guard_for_same_candidate');
    expect(result).toContain('### Current Anchor Next Options');
    expect(result).toContain('- anchor3: finish step3');
  });
});

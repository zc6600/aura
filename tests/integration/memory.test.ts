import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { Runner } from '../../src/core/kernel/runner.js';
import { MemoryBase } from '../../src/core/memory/base.js';
import { MemoryConfig } from '../../src/core/memory/config.js';
import { MemoryPolicy } from '../../src/core/memory/policy.js';
import { MemoryProvider } from '../../src/core/memory/provider.js';
import { MemoryRecorder } from '../../src/core/memory/recorder.js';
import { SessionManager } from '../../src/core/memory/sessionManager.js';
import { SQLiteStore } from '../../src/core/memory/sqliteStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CountRow {
  count: number;
}

describe('Memory Integration', { timeout: 30000 }, () => {
  let testDir: string;
  let config: MemoryConfig;
  let memory: MemoryBase;

  beforeEach(() => {
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'aura-memory-integration-'),
    );
    config = new MemoryConfig({
      store: {
        project_path: testDir,
        db_path: path.join(testDir, 'state', 'aura.db'),
      },
      metabolism: { max_chars: 100000, recent_events_n: 20 },
    });
    memory = new MemoryBase({ config });
  });

  afterEach(() => {
    try {
      if (memory?.store) {
        memory.store.close();
      }
    } catch (_e) {}

    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch (_e) {}
  });

  // 1. Metabolizer Public API
  describe('Metabolizer Public API', () => {
    it('metabolizer public methods are accessible', async () => {
      const metabolizer = memory.metabolizer;
      expect(typeof metabolizer.runIfNeeded).toBe('function');
      expect(typeof metabolizer.run).toBe('function');

      const result = await metabolizer.runIfNeeded();
      expect(result).toHaveProperty('total_events');
    });

    it('run alias works', async () => {
      const metabolizer = memory.metabolizer;
      const result1 = await metabolizer.runIfNeeded();
      const result2 = await metabolizer.run();
      expect(Object.keys(result1)).toEqual(Object.keys(result2));
    });

    it('metabolizer integration works', async () => {
      for (let i = 0; i < 50; i++) {
        memory.recorder.recordUser(`Event ${i}`);
      }

      const result = await memory.metabolizer.run();
      expect(result).toHaveProperty('total_events');
      expect(result.total_events).toBe(50);
    });
  });

  // 2. Runner Integration
  describe('Runner Integration', () => {
    let runnerTestDir: string;

    beforeEach(() => {
      runnerTestDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'aura-runner-integration-'),
      );
      fs.mkdirSync(path.join(runnerTestDir, 'config'), { recursive: true });
      fs.writeFileSync(
        path.join(runnerTestDir, 'config', 'config.yml'),
        yaml.stringify({
          state_management: {
            max_state_chars: 100000,
            recent_events_n: 20,
          },
        }),
      );
    });

    afterEach(() => {
      try {
        if (fs.existsSync(runnerTestDir)) {
          fs.rmSync(runnerTestDir, { recursive: true, force: true });
        }
      } catch (_e) {}
    });

    it('runner initialization with memory', () => {
      const runner = new Runner(runnerTestDir);
      expect(runner).toBeInstanceOf(Runner);
      expect(runner.memory).toBeInstanceOf(MemoryBase);
      expect(runner.memory.recorder).toBeInstanceOf(MemoryRecorder);
      expect(runner.memory.provider).toBeInstanceOf(MemoryProvider);
      expect(runner.memory.metabolizer).toBeDefined();
      runner.memory.store.close();
    });

    it('runner record user input', () => {
      const runner = new Runner(runnerTestDir);
      const eventId = runner.recordUserInput('Hello, test!');
      expect(typeof eventId).toBe('number');

      const events = runner.memory.provider.recentEvents();
      expect(events.length).toBe(1);
      expect(events[0].phase).toBe('user');
      expect(events[0].payload.content).toBe('Hello, test!');
      runner.memory.store.close();
    });

    it('memory adapter compatibility', () => {
      const runner = new Runner(runnerTestDir);
      runner.memory.store.setVariable('test_key', 'test_value');
      expect(runner.memory.store.getVariable('test_key')).toBe('test_value');
      runner.memory.store.close();
    });

    it('full workflow simulation', () => {
      const runner = new Runner(runnerTestDir);
      const job = runner.startJob();
      expect(job).toBeDefined();
      expect(job.status).toBe('running');

      runner.recordUserInput('List files');
      const events = runner.memory.provider.recentEvents();
      expect(events.length).toBe(1);

      runner.endJob();
      runner.memory.store.close();
    });
  });

  // 3. Session Manager
  describe('Session Manager', () => {
    let sessionDir: string;
    let manager: SessionManager;

    beforeEach(() => {
      sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-session-mgr-'));
      manager = new SessionManager(sessionDir);
    });

    afterEach(() => {
      try {
        if (fs.existsSync(sessionDir)) {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        }
      } catch (_e) {}
    });

    it('create session', () => {
      const session = manager.create('test-session', {
        description: 'Test session',
      });
      expect(session.name).toBe('test-session');
      expect(session.db_path).toContain('test-session.db');
      expect(session.created_at).toBeDefined();
      expect(session.description).toBe('Test session');
      expect(manager.exists('test-session')).toBe(true);
    });

    it('create duplicate session throws error', () => {
      manager.create('session-a');
      expect(() => manager.create('session-a')).toThrow();
    });

    it('activate session', async () => {
      const session = manager.create('session-b');
      const createdTime = session.last_active_at;

      await new Promise((resolve) => setTimeout(resolve, 50));
      const dbPath = manager.activate('session-b');

      expect(dbPath).toContain('session-b.db');
      expect(manager.currentName()).toBe('session-b');
      expect(process.env.AURA_SESSION_NAME).toBe('session-b');

      const sessions = manager.loadMetadata();
      expect(
        new Date(sessions['session-b'].last_active_at).getTime(),
      ).toBeGreaterThan(new Date(createdTime).getTime());
    });

    it('activate nonexistent session throws error', () => {
      expect(() => manager.activate('nonexistent')).toThrow();
    });

    it('list sessions', () => {
      manager.create('session-1');
      manager.create('session-2');
      const sessions = manager.list();
      expect(sessions.length).toBe(2);
      expect(sessions.some((s) => s.name === 'session-1')).toBe(true);
      expect(sessions.some((s) => s.name === 'session-2')).toBe(true);
    });

    it('delete session', () => {
      manager.create('to-delete');
      expect(manager.exists('to-delete')).toBe(true);

      manager.delete('to-delete');
      expect(manager.exists('to-delete')).toBe(false);

      const sessions = manager.loadMetadata();
      expect(sessions).not.toHaveProperty('to-delete');
    });

    it('rename session', () => {
      manager.create('old-name');
      manager.rename('old-name', 'new-name');

      expect(manager.exists('old-name')).toBe(false);
      expect(manager.exists('new-name')).toBe(true);

      const sessions = manager.loadMetadata();
      expect(sessions).not.toHaveProperty('old-name');
      expect(sessions).toHaveProperty('new-name');
    });

    it('rename updates active session', () => {
      manager.create('old-name');
      manager.activate('old-name');
      expect(manager.currentName()).toBe('old-name');

      manager.rename('old-name', 'renamed');
      expect(manager.currentName()).toBe('renamed');
    });

    it('duplicate session', () => {
      manager.create('original');
      const dbPath = manager.dbPathFor('original');
      const db = new Database(dbPath);
      db.prepare(
        'INSERT INTO events (timestamp, phase, tool, payload) VALUES (?, ?, ?, ?)',
      ).run(
        Math.floor(Date.now() / 1000),
        'user',
        null,
        JSON.stringify({ content: 'test' }),
      );
      db.close();

      manager.duplicate('original', 'copy');
      expect(manager.exists('copy')).toBe(true);

      const copyDbPath = manager.dbPathFor('copy');
      const copyDb = new Database(copyDbPath);
      const countRow = copyDb
        .prepare('SELECT COUNT(*) as count FROM events')
        .get() as CountRow;
      expect(countRow.count).toBe(1);
      copyDb.close();
    });

    it('export and import', () => {
      manager.create('export-me');
      const exportPath = path.join(sessionDir, 'exported.db');
      manager.export('export-me', exportPath);
      expect(fs.existsSync(exportPath)).toBe(true);

      manager.import(exportPath, 'imported');
      expect(manager.exists('imported')).toBe(true);
    });

    it('session isolation', () => {
      manager.create('session-a');
      manager.create('session-b');

      const dbA = manager.dbPathFor('session-a');
      const dbB = manager.dbPathFor('session-b');

      const db = new Database(dbA);
      db.prepare(
        'INSERT INTO events (timestamp, phase, tool, payload) VALUES (?, ?, ?, ?)',
      ).run(
        Math.floor(Date.now() / 1000),
        'user',
        null,
        JSON.stringify({ content: 'data for A' }),
      );
      db.close();

      const db2 = new Database(dbB);
      const countRow = db2
        .prepare('SELECT COUNT(*) as count FROM events')
        .get() as CountRow;
      expect(countRow.count).toBe(0);
      db2.close();
    });

    it('validate session name', () => {
      expect(() => manager.create('')).toThrow();
      expect(() => manager.create('bad/name')).toThrow();
      expect(() => manager.create('bad..name')).toThrow();
    });

    it('list includes stats', () => {
      manager.create('with-stats');
      const dbPath = manager.dbPathFor('with-stats');
      const db = new Database(dbPath);
      for (let i = 0; i < 3; i++) {
        db.prepare(
          'INSERT INTO events (timestamp, phase, tool, payload) VALUES (?, ?, ?, ?)',
        ).run(
          Math.floor(Date.now() / 1000),
          'user',
          null,
          JSON.stringify({ content: `event ${i}` }),
        );
      }
      db.close();

      const sessions = manager.list();
      const statsSession = sessions.find((s) => s.name === 'with-stats');
      expect(statsSession).toBeDefined();
      expect(statsSession?.event_count).toBe(3);
      expect(statsSession?.turn_count).toBeGreaterThan(0);
    });

    it('integration with runner reconnect', () => {
      manager.create('integration-test');
      manager.activate('integration-test');

      const runner = new Runner(sessionDir);
      expect(runner.memory.store.dbPath).toContain('integration-test.db');

      runner.recordUserInput('Hello from integration test');
      runner.memory.store.close();

      const dbPath = manager.dbPathFor('integration-test');
      const db = new Database(dbPath);
      const countRow = db
        .prepare("SELECT COUNT(*) as count FROM events WHERE phase = 'user'")
        .get() as CountRow;
      expect(countRow.count).toBe(1);
      db.close();
    });
  });

  // 4. Memory Bugs / Edge Cases
  describe('Memory Bugs / Edge Cases', () => {
    it('recent events returns newest in chronological order', () => {
      for (let i = 0; i < 5; i++) {
        memory.recorder.recordUser(`User Event ${i}`);
      }

      const events = memory.provider.recentEvents({ limit: 3 });
      expect(events.length).toBe(3);
      expect(events[0].payload.content).toBe('User Event 2');
      expect(events[1].payload.content).toBe('User Event 3');
      expect(events[2].payload.content).toBe('User Event 4');
      expect(events[0].id).toBeLessThan(events[1].id);
      expect(events[1].id).toBeLessThan(events[2].id);
    });

    it('recent summaries returns newest in chronological order', () => {
      for (let i = 0; i < 5; i++) {
        memory.store.insertSummary(`Summary ${i}`);
      }

      const summaries = memory.provider.recentSummaries(3);
      expect(summaries.length).toBe(3);
      expect(summaries[0].content).toBe('Summary 2');
      expect(summaries[1].content).toBe('Summary 3');
      expect(summaries[2].content).toBe('Summary 4');
      expect(summaries[0].id).toBeLessThan(summaries[1].id);
      expect(summaries[1].id).toBeLessThan(summaries[2].id);
    });

    it('old events excludes recent ones', () => {
      for (let i = 0; i < 10; i++) {
        memory.recorder.recordUser(`Event ${i}`);
      }

      const old = memory.provider.oldEvents(3);
      expect(old.length).toBe(7);
      expect(old[0].payload.content).toBe('Event 0');
      expect(old[old.length - 1].payload.content).toBe('Event 6');

      const hasRecent = old.some((e) =>
        /Event (7|8|9)/.test(String(e.payload.content)),
      );
      expect(hasRecent).toBe(false);
    });

    it('new user event clears undone stack', () => {
      memory.recorder.recordUser('User Event');
      memory.recorder.recordExecution('tool', { status: 'ok' });

      expect(memory.undo()).toBe(true);

      const db = memory.store.getRawDb();
      const undoneCount = (
        db
          .prepare('SELECT COUNT(*) as count FROM undone_events')
          .get() as CountRow
      ).count;
      expect(undoneCount).toBeGreaterThan(0);

      memory.recorder.recordUser('New User Event');
      const undoneCountAfter = (
        db
          .prepare('SELECT COUNT(*) as count FROM undone_events')
          .get() as CountRow
      ).count;
      expect(undoneCountAfter).toBe(0);
    });
  });

  // 5. SQLite Store Operations & Policy
  describe('SQLite Store and Policy Operations', () => {
    it('sqlite store basic operations', () => {
      const basicDbPath = path.join(testDir, 'basic_store.db');
      const store = new SQLiteStore({ dbPath: basicDbPath });
      const eventId = store.insertEvent({
        timestamp: Math.floor(Date.now() / 1000),
        phase: 'user',
        tool: '',
        payload: { content: 'Hello' },
      });
      expect(eventId).toBeGreaterThan(0);

      const events = store.fetchEvents();
      expect(events.length).toBe(1);
      expect(events[0].phase).toBe('user');
      expect(events[0].payload.content).toBe('Hello');

      store.close();
    });

    it('policy basic behavior', () => {
      const policy = new MemoryPolicy({
        tiers: {
          ephemeral: { phases: ['execution'], max_steps: 10, summarize: true },
          permanent: { phases: ['milestone'], permanent: true },
        },
      });

      const event1 = { phase: 'execution' };
      expect(policy.shouldSummarize(event1)).toBe(true);
      expect(policy.tierFor(event1)).toBe('ephemeral');

      const event2 = { phase: 'milestone' };
      expect(policy.isPermanent(event2)).toBe(true);
      expect(policy.tierFor(event2)).toBe('permanent');
    });

    it('policy apply behavior', () => {
      const policy = new MemoryPolicy({
        retention: {
          execution: { max_steps: 1, summarize: false },
          plan: { max_steps: 1, summarize: true },
          milestone: { permanent: true },
        },
      });

      const events = [
        { id: 1, phase: 'execution' },
        { id: 2, phase: 'plan' },
        { id: 3, phase: 'milestone' },
      ];

      const result = policy.apply(events as any);
      expect(result.to_summarize.length).toBe(1);
      expect(result.to_delete.length).toBe(2); // execution deletes, plan gets summarized then deleted
      expect(result.to_keep.length).toBe(1);
    });
  });

  // 6. Backward Compatibility
  describe('Backward Compatibility Checks', () => {
    it('all event types have phase and tool fields in parsed payload', () => {
      memory.recorder.recordUser('user event');
      memory.recorder.recordPlan({
        type: 'tool_call',
        tool: 'test',
        args: {},
        thought: 'Thinking...',
      });
      memory.recorder.recordExecution('test_tool', { status: 'ok' });
      memory.recorder.recordInterception(
        'blocked_tool',
        'advice text',
        'reason text',
      );
      memory.recorder.recordCustom('custom_phase', { data: 'custom_data' });

      const events = memory.provider.recentEvents();
      expect(events.length).toBe(5);

      for (const event of events) {
        const payload = event.payload;
        expect(payload).toBeDefined();
        expect(payload).toHaveProperty('phase');
        expect(payload.phase).toBe(event.phase);

        if (['plan', 'execution', 'interception'].includes(event.phase)) {
          expect(payload).toHaveProperty('tool');
          expect(payload.tool).toBe(event.tool);
        }
      }
    });
  });
});

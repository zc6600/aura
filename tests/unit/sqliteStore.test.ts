import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SQLiteStore } from '../../src/core/memory/sqliteStore.js';

describe('SQLiteStore', () => {
  const tempDir = path.resolve(__dirname, 'temp-sqlite-test');
  const dbPath = path.join(tempDir, 'test.db');
  let store: SQLiteStore;

  beforeAll(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    store = new SQLiteStore({ dbPath });
  });

  afterAll(() => {
    store.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Table initialization', () => {
    it('should create all required tables', () => {
      const db = store.getRawDb();
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((row: any) => row.name);

      expect(tables).toContain('events');
      expect(tables).toContain('summaries');
      expect(tables).toContain('variables');
      expect(tables).toContain('undone_events');
      expect(tables).toContain('undone_summaries');
    });
  });

  describe('Events and Variables operations', () => {
    it('should insert and fetch events', () => {
      const ts = Math.floor(Date.now() / 1000);
      const payload = { text: 'hello' };
      const eventId = store.insertEvent({
        timestamp: ts,
        phase: 'developer',
        tool: 'read_file',
        payload,
      });

      expect(eventId).toBeGreaterThan(0);

      const events = store.fetchEvents({ limit: 10 });
      expect(events.length).toBe(1);
      expect(events[0].id).toBe(eventId);
      expect(events[0].phase).toBe('developer');
      expect(events[0].tool).toBe('read_file');
      expect(events[0].payload).toEqual(payload);
    });

    it('should set and get variables', () => {
      store.setVariable('name', 'Alice');
      expect(store.getVariable('name')).toBe('Alice');

      const vars = store.allVariables();
      expect(vars).toEqual({ name: 'Alice' });
    });
  });

  describe('Undo and Redo flow', () => {
    it('should undo and redo user turns correctly', () => {
      const ts = Math.floor(Date.now() / 1000);
      
      // Turn 1: User input
      const userEventId = store.insertEvent({
        timestamp: ts,
        phase: 'user',
        tool: 'input',
        payload: { text: 'User prompt' },
      });

      // Turn 2: Assistant output
      store.insertEvent({
        timestamp: ts + 1,
        phase: 'developer',
        tool: 'read_file',
        payload: { file: 'a.txt' },
      });

      expect(store.countEvents()).toBe(3); // 1 from previous test, 2 from this test

      // Undo turn
      const undoOk = store.undoLastTurn();
      expect(undoOk).toBe(true);
      expect(store.countEvents()).toBe(1); // Back to 1 (only the first test event remains)

      // Redo turn
      const redoOk = store.redoLastTurn();
      expect(redoOk).toBe(true);
      expect(store.countEvents()).toBe(3); // Back to 3 events
    });
  });
});

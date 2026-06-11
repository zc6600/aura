import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as PathResolver from '../../utils/pathResolver.js';

export interface SQLiteStoreConfig {
  dbPath?: string;
  projectPath?: string;
  db?: import('better-sqlite3').Database;
}

export interface EventRecord {
  id: number;
  timestamp: number;
  phase: string;
  tool: string;
  payload: Record<string, unknown>;
}

export interface SummaryRecord {
  id: number;
  timestamp: number;
  content: string;
  source_event_id?: number | null;
}

export class SQLiteStore {
  public readonly dbPath: string;
  public readonly db: Database.Database;

  constructor(config: SQLiteStoreConfig = {}) {
    if (config.db) {
      this.db = config.db;
      this.dbPath = (config.db as import('better-sqlite3').Database).name || '';
    } else {
      if (config.dbPath) {
        this.dbPath = path.resolve(config.dbPath);
      } else if (config.projectPath) {
        this.dbPath = PathResolver.sessionDbPath(config.projectPath);
      } else {
        throw new Error(
          'ArgumentError: Either db, dbPath or projectPath must be provided',
        );
      }

      // Ensure the folder exists
      if (this.dbPath) {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }

      this.db = new Database(this.dbPath);
    }

    this.db.pragma('journal_mode=WAL');
    this.db.pragma('synchronous=NORMAL');

    this.createTables();
    this.migrateTables();
  }

  public getRawDb(): Database.Database {
    return this.db;
  }

  public fetchAnchorSubmitEvents(): {
    payload: Record<string, unknown>;
    timestamp: number;
  }[] {
    try {
      const rows = this.db
        .prepare(
          "SELECT payload, timestamp FROM events WHERE tool = 'anchor_submit'",
        )
        .all() as { payload: string; timestamp: number }[];
      return rows.map((row) => {
        let parsedPayload: Record<string, unknown> = {};
        try {
          parsedPayload = JSON.parse(row.payload);
        } catch {
          // Ignore
        }
        return {
          payload: parsedPayload,
          timestamp: row.timestamp,
        };
      });
    } catch {
      return [];
    }
  }

  public insertEvent(options: {
    timestamp: number;
    phase: string;
    tool: string;
    payload: Record<string, unknown>;
  }): number {
    const { timestamp, phase, tool, payload } = options;

    if (phase === 'user') {
      this.db.prepare('DELETE FROM undone_events').run();
      this.db.prepare('DELETE FROM undone_summaries').run();
    }

    const payloadStr =
      typeof payload === 'string' ? payload : JSON.stringify(payload);

    const info = this.db
      .prepare(
        'INSERT INTO events (timestamp, phase, tool, payload) VALUES (?, ?, ?, ?)',
      )
      .run(timestamp, phase, tool, payloadStr);

    return Number(info.lastInsertRowid);
  }

  public fetchEvents(
    options: {
      limit?: number;
      offset?: number;
      phases?: string[];
      since?: number;
      tools?: string[];
    } = {},
  ): EventRecord[] {
    const { limit, offset, phases, since, tools } = options;
    let query = 'SELECT id, timestamp, phase, tool, payload FROM events';
    const conditions: string[] = [];
    const args: unknown[] = [];

    if (phases && phases.length > 0) {
      const placeholders = phases.map(() => '?').join(',');
      conditions.push(`phase IN (${placeholders})`);
      args.push(...phases);
    }

    if (tools && tools.length > 0) {
      const placeholders = tools.map(() => '?').join(',');
      conditions.push(`tool IN (${placeholders})`);
      args.push(...tools);
    }

    if (since !== undefined && since !== null) {
      conditions.push('timestamp >= ?');
      args.push(since);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY id DESC';

    if (offset !== undefined && offset !== null) {
      query += ' LIMIT ? OFFSET ?';
      args.push(limit ?? -1);
      args.push(offset);
    } else if (limit !== undefined && limit !== null) {
      query += ' LIMIT ?';
      args.push(limit);
    }

    const rows = this.db.prepare(query).all(...args) as EventRecord[];

    const events = rows.map((row) => {
      let parsedPayload: Record<string, unknown> = row.payload;
      if (typeof row.payload === 'string') {
        try {
          parsedPayload = JSON.parse(row.payload);
        } catch {
          // Keep string if not parseable
        }
      }
      return {
        id: row.id,
        timestamp: row.timestamp,
        phase: row.phase,
        tool: row.tool,
        payload: parsedPayload,
      };
    });

    // Ruby version sorts by id ASC after fetching
    return events.sort((a, b) => a.id - b.id);
  }

  public deleteEvents(eventIds: number[]): void {
    if (eventIds.length === 0) return;
    const placeholders = eventIds.map(() => '?').join(',');
    this.db
      .prepare(`DELETE FROM events WHERE id IN (${placeholders})`)
      .run(...eventIds);
  }

  public countEvents(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM events')
      .get() as { count: number };
    return row ? Number(row.count) : 0;
  }

  public totalEventsChars(): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(LENGTH(payload)), 0) as total FROM events')
      .get() as { total: number };
    return row ? Number(row.total) : 0;
  }

  public insertSummary(
    contentOrObj: string | { content: string; source_event_id?: number | null },
    sourceEventId?: number | null,
  ): number {
    let content: string;
    let eventId: number | null = null;
    if (contentOrObj && typeof contentOrObj === 'object') {
      content = contentOrObj.content;
      eventId = contentOrObj.source_event_id ?? null;
    } else {
      content = contentOrObj as string;
      eventId = sourceEventId ?? null;
    }

    const info = this.db
      .prepare(
        'INSERT INTO summaries (timestamp, content, source_event_id) VALUES (?, ?, ?)',
      )
      .run(Math.floor(Date.now() / 1000), content, eventId);

    return Number(info.lastInsertRowid);
  }

  public fetchSummaries(
    limitOrOptions?: number | { limit?: number },
  ): SummaryRecord[] {
    let query =
      'SELECT id, timestamp, content, source_event_id FROM summaries ORDER BY id DESC';
    const args: unknown[] = [];

    let limit: number | undefined;
    if (typeof limitOrOptions === 'number') {
      limit = limitOrOptions;
    } else if (limitOrOptions && typeof limitOrOptions === 'object') {
      limit = limitOrOptions.limit;
    }

    if (limit !== undefined && limit !== null) {
      query += ' LIMIT ?';
      args.push(limit);
    }

    const rows = this.db.prepare(query).all(...args) as SummaryRecord[];

    const summaries = rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      content: row.content,
      source_event_id: row.source_event_id,
    }));

    return summaries.sort((a, b) => a.id - b.id);
  }

  public setVariable(key: string, value: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO variables (key, value) VALUES (?, ?)')
      .run(key, value);
  }

  public getVariable(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM variables WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  public allVariables(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM variables').all() as {
      key: string;
      value: string;
    }[];
    const vars: Record<string, string> = {};
    for (const row of rows) {
      vars[row.key] = row.value;
    }
    return vars;
  }

  public transaction<T>(fn: () => T): T {
    const runTx = this.db.transaction(fn);
    return runTx();
  }

  public close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }

  public undoLastTurn(): boolean {
    const row = this.db
      .prepare(
        "SELECT id FROM events WHERE phase = 'user' ORDER BY id DESC LIMIT 1",
      )
      .get() as { id: number } | undefined;
    if (!row) return false;

    const lastUserId = row.id;

    this.transaction(() => {
      // Move events to undone_events
      this.db
        .prepare(
          'INSERT OR REPLACE INTO undone_events SELECT * FROM events WHERE id >= ?',
        )
        .run(lastUserId);
      this.db.prepare('DELETE FROM events WHERE id >= ?').run(lastUserId);

      // Move summaries to undone_summaries
      this.db
        .prepare(
          'INSERT OR REPLACE INTO undone_summaries SELECT * FROM summaries WHERE source_event_id >= ?',
        )
        .run(lastUserId);
      this.db
        .prepare('DELETE FROM summaries WHERE source_event_id >= ?')
        .run(lastUserId);
    });

    return true;
  }

  public redoLastTurn(): boolean {
    // Find the earliest user event in undone_events
    const row = this.db
      .prepare("SELECT MIN(id) as id FROM undone_events WHERE phase = 'user'")
      .get() as { id: number } | undefined;
    if (!row || row.id === null || row.id === undefined) return false;

    const nextUserId = row.id;

    // Find the next user event after that to define range bounds
    const nextRow = this.db
      .prepare(
        "SELECT MIN(id) as id FROM undone_events WHERE phase = 'user' AND id > ?",
      )
      .get(nextUserId) as { id: number } | undefined;
    const followingUserId = nextRow ? nextRow.id : null;

    this.transaction(() => {
      if (followingUserId !== null && followingUserId !== undefined) {
        // Restore single turn
        this.db
          .prepare(
            'INSERT OR REPLACE INTO events SELECT * FROM undone_events WHERE id >= ? AND id < ?',
          )
          .run(nextUserId, followingUserId);
        this.db
          .prepare('DELETE FROM undone_events WHERE id >= ? AND id < ?')
          .run(nextUserId, followingUserId);

        this.db
          .prepare(
            'INSERT OR REPLACE INTO summaries SELECT * FROM undone_summaries WHERE source_event_id >= ? AND source_event_id < ?',
          )
          .run(nextUserId, followingUserId);
        this.db
          .prepare(
            'DELETE FROM undone_summaries WHERE source_event_id >= ? AND source_event_id < ?',
          )
          .run(nextUserId, followingUserId);
      } else {
        // Restore tail
        this.db
          .prepare(
            'INSERT OR REPLACE INTO events SELECT * FROM undone_events WHERE id >= ?',
          )
          .run(nextUserId);
        this.db
          .prepare('DELETE FROM undone_events WHERE id >= ?')
          .run(nextUserId);

        this.db
          .prepare(
            'INSERT OR REPLACE INTO summaries SELECT * FROM undone_summaries WHERE source_event_id >= ?',
          )
          .run(nextUserId);
        this.db
          .prepare('DELETE FROM undone_summaries WHERE source_event_id >= ?')
          .run(nextUserId);
      }
    });

    return true;
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER,
        phase TEXT,
        tool TEXT,
        payload TEXT
      );

      CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER,
        content TEXT,
        source_event_id INTEGER
      );

      CREATE TABLE IF NOT EXISTS variables (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS undone_events (
        id INTEGER PRIMARY KEY,
        timestamp INTEGER,
        phase TEXT,
        tool TEXT,
        payload TEXT
      );

      CREATE TABLE IF NOT EXISTS undone_summaries (
        id INTEGER PRIMARY KEY,
        timestamp INTEGER,
        content TEXT,
        source_event_id INTEGER
      );
    `);
  }

  private migrateTables(): void {
    const tableInfo = this.db.prepare('PRAGMA table_info(summaries)').all() as {
      name: string;
    }[];
    const columns = tableInfo.map((col) => col.name);
    if (!columns.includes('source_event_id')) {
      this.db.exec('ALTER TABLE summaries ADD COLUMN source_event_id INTEGER');
    }
  }
}

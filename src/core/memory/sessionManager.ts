import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as PathResolver from '../../utils/pathResolver.js';
import { SQLiteStore } from './sqliteStore.js';

export interface SessionInfo {
  name: string;
  db_path: string;
  created_at: string;
  last_active_at: string;
  description: string;
  tags: string[];
  turn_count: number;
  event_count: number;
  summary_count?: number;
  last_event_at?: string | null;
}

export class SessionManager {
  public readonly envPath: string;
  public readonly stateDir: string;
  private readonly sessionsDir: string;
  private readonly metadataFile: string;

  constructor(projectPath: string) {
    const resolvedEnv =
      PathResolver.environmentPath(projectPath) || projectPath;
    this.envPath = path.resolve(resolvedEnv);
    this.stateDir = path.join(this.envPath, 'state');
    this.sessionsDir = path.join(this.stateDir, 'sessions');
    this.metadataFile = path.join(this.stateDir, 'sessions.json');
    fs.mkdirSync(this.sessionsDir, { recursive: true });
  }

  public get projectPath(): string {
    return this.envPath;
  }

  public create(
    name: string,
    metadata: { description?: string; tags?: string[] } = {},
  ): SessionInfo {
    this.validateSessionName(name);

    const dbPath = this.dbPathFor(name);
    if (fs.existsSync(dbPath)) {
      throw new Error(`Session '${name}' already exists`);
    }

    try {
      // Initialize the database structure by instantiating and closing SQLiteStore
      const store = new SQLiteStore({ dbPath });
      store.close();
    } catch (e: any) {
      throw new Error(`Failed to initialize session DB: ${e.message}`);
    }

    const sessionInfo: SessionInfo = {
      name,
      db_path: dbPath,
      created_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
      description: metadata.description || '',
      tags: metadata.tags || [],
      turn_count: 0,
      event_count: 0,
    };

    const sessions = this.loadMetadata();
    sessions[name] = sessionInfo;
    this.saveMetadata(sessions);

    return sessionInfo;
  }

  public exists(name: string): boolean {
    const dbPath = this.dbPathFor(name);
    return fs.existsSync(dbPath) || Object.hasOwn(this.loadMetadata(), name);
  }

  public activate(name: string): string {
    if (!this.exists(name)) {
      throw new Error(`Session '${name}' does not exist`);
    }

    const activeFile = path.join(this.stateDir, 'active_session.txt');
    const tempPath = `${activeFile}.tmp`;
    fs.writeFileSync(tempPath, name, 'utf-8');
    fs.renameSync(tempPath, activeFile);

    const sessions = this.loadMetadata();
    if (sessions[name]) {
      sessions[name].last_active_at = new Date().toISOString();
      this.saveMetadata(sessions);
    }

    process.env.AURA_SESSION_NAME = name;
    delete process.env.AURA_STATE_DB_PATH;

    return this.dbPathFor(name);
  }

  public currentName(): string | null {
    const activeFile = path.join(this.stateDir, 'active_session.txt');
    if (!fs.existsSync(activeFile)) {
      return null;
    }
    try {
      return fs.readFileSync(activeFile, 'utf-8').trim();
    } catch (_e) {
      return null;
    }
  }

  public currentDbPath(): string | null {
    const name = this.currentName();
    return name ? this.dbPathFor(name) : null;
  }

  public list(options: { includeMissing?: boolean } = {}): SessionInfo[] {
    const sessionsMap = this.loadMetadata();

    // Auto-discover databases in the sessions directory
    if (fs.existsSync(this.sessionsDir)) {
      const files = fs.readdirSync(this.sessionsDir);
      for (const file of files) {
        if (file.endsWith('.db')) {
          const name = path.basename(file, '.db');
          if (!sessionsMap[name]) {
            const dbPath = this.dbPathFor(name);
            let stat: fs.Stats;
            try {
              stat = fs.statSync(dbPath);
            } catch (_e) {
              continue;
            }
            sessionsMap[name] = {
              name,
              db_path: dbPath,
              created_at: stat.birthtime.toISOString(),
              last_active_at: stat.mtime.toISOString(),
              description:
                name === 'default'
                  ? 'Default session'
                  : 'Auto-discovered session',
              tags: [],
              turn_count: 0,
              event_count: 0,
            };
          }
        }
      }
      this.saveMetadata(sessionsMap);
    }

    const sessions = Object.values(sessionsMap);

    const enriched = sessions.map((info) => {
      if (fs.existsSync(info.db_path)) {
        try {
          const stats = this.getSessionStats(info.db_path);
          return { ...info, ...stats };
        } catch (_e) {
          return info;
        }
      }
      return info;
    });

    if (options.includeMissing) {
      return enriched;
    }
    return enriched.filter((s) => fs.existsSync(s.db_path));
  }

  public delete(name: string): boolean {
    if (!this.exists(name)) {
      throw new Error(`Session '${name}' does not exist`);
    }

    const dbPath = this.dbPathFor(name);
    try {
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      // Also clean SQLite sidecars if they exist
      for (const suffix of ['-journal', '-wal', '-shm']) {
        const sidecar = `${dbPath}${suffix}`;
        if (fs.existsSync(sidecar)) {
          fs.unlinkSync(sidecar);
        }
      }
    } catch (_e) {
      // Ignore filesystem errors
    }

    const sessions = this.loadMetadata();
    delete sessions[name];
    this.saveMetadata(sessions);

    return true;
  }

  public rename(oldName: string, newName: string): SessionInfo {
    this.validateSessionName(newName);

    if (!this.exists(oldName)) {
      throw new Error(`Session '${oldName}' does not exist`);
    }

    const newDb = this.dbPathFor(newName);
    if (fs.existsSync(newDb)) {
      throw new Error(`Session '${newName}' already exists`);
    }

    const oldDb = this.dbPathFor(oldName);
    if (fs.existsSync(oldDb)) {
      fs.renameSync(oldDb, newDb);
      // Rename sidecars if any
      for (const suffix of ['-journal', '-wal', '-shm']) {
        const oldSide = `${oldDb}${suffix}`;
        const newSide = `${newDb}${suffix}`;
        if (fs.existsSync(oldSide)) {
          fs.renameSync(oldSide, newSide);
        }
      }
    }

    const sessions = this.loadMetadata();
    const info = sessions[oldName];
    delete sessions[oldName];

    if (info) {
      info.name = newName;
      info.db_path = newDb;
      sessions[newName] = info;
      this.saveMetadata(sessions);
    }

    if (this.currentName() === oldName) {
      this.activate(newName);
    }

    return (
      info || {
        name: newName,
        db_path: newDb,
        created_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
        description: 'Renamed session',
        tags: [],
        turn_count: 0,
        event_count: 0,
      }
    );
  }

  public duplicate(sourceName: string, newName: string): SessionInfo {
    if (!this.exists(sourceName)) {
      throw new Error(`Session '${sourceName}' does not exist`);
    }

    const newDb = this.dbPathFor(newName);
    if (fs.existsSync(newDb)) {
      throw new Error(`Session '${newName}' already exists`);
    }

    const sourceDb = this.dbPathFor(sourceName);
    const db = new Database(sourceDb);
    try {
      db.prepare('VACUUM INTO ?').run(newDb);
    } finally {
      db.close();
    }

    const sessionInfo: SessionInfo = {
      name: newName,
      db_path: newDb,
      created_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
      description: `Duplicate of ${sourceName}`,
      tags: [],
      turn_count: 0,
      event_count: 0,
    };

    const sessions = this.loadMetadata();
    sessions[newName] = sessionInfo;
    this.saveMetadata(sessions);

    return sessionInfo;
  }

  public export(name: string, destPath: string): void {
    if (!this.exists(name)) {
      throw new Error(`Session '${name}' does not exist`);
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
    }
    const sourceDb = this.dbPathFor(name);
    const db = new Database(sourceDb);
    try {
      db.prepare('VACUUM INTO ?').run(destPath);
    } finally {
      db.close();
    }
  }

  public import(sourcePath: string, name: string): SessionInfo {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source file '${sourcePath}' does not exist`);
    }

    const dbPath = this.dbPathFor(name);
    if (fs.existsSync(dbPath)) {
      throw new Error(`Session '${name}' already exists`);
    }

    fs.copyFileSync(sourcePath, dbPath);

    const sessionInfo: SessionInfo = {
      name,
      db_path: dbPath,
      created_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
      description: `Imported from ${sourcePath}`,
      tags: [],
      turn_count: 0,
      event_count: 0,
    };

    const sessions = this.loadMetadata();
    sessions[name] = sessionInfo;
    this.saveMetadata(sessions);

    return sessionInfo;
  }

  public dbPathFor(name: string): string {
    return path.join(this.sessionsDir, `${name}.db`);
  }

  public loadMetadata(): Record<string, SessionInfo> {
    if (!fs.existsSync(this.metadataFile)) {
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(this.metadataFile, 'utf-8')) || {};
    } catch (_e) {
      return {};
    }
  }

  private validateSessionName(name: string): void {
    if (!name?.trim()) {
      throw new Error('Session name cannot be empty');
    }
    if (name.includes('/') || name.includes('\\')) {
      throw new Error('Session name cannot contain path separators');
    }
    if (name.includes('..')) {
      throw new Error("Session name cannot contain '..'");
    }
  }

  private saveMetadata(sessions: Record<string, SessionInfo>): void {
    try {
      const tempPath = `${this.metadataFile}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(sessions, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.metadataFile);
    } catch (e: unknown) {
      console.warn(
        `[SessionManager] Failed to save metadata: ${(e as Error).message}`,
      );
    }
  }

  private getSessionStats(dbPath: string): Partial<SessionInfo> {
    let db: Database.Database | undefined;
    try {
      db = new Database(dbPath);
      // check tables exist
      const tableCheck = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='events'",
        )
        .get() as { name: string } | undefined;
      if (!tableCheck) {
        db.close();
        return {};
      }

      const eventCountRow = db
        .prepare('SELECT COUNT(*) as count FROM events')
        .get() as { count: number };
      const summaryCountRow = db
        .prepare('SELECT COUNT(*) as count FROM summaries')
        .get() as { count: number };
      const lastTimeRow = db
        .prepare('SELECT MAX(timestamp) as max_ts FROM events')
        .get() as { max_ts: number } | undefined;

      const event_count = Number(eventCountRow?.count || 0);
      const summary_count = Number(summaryCountRow?.count || 0);
      const last_ts = lastTimeRow?.max_ts;

      db.close();

      return {
        event_count,
        summary_count,
        turn_count: Math.ceil(event_count / 3.0),
        last_event_at: last_ts
          ? new Date(Number(last_ts) * 1000).toISOString()
          : null,
      };
    } catch (_e) {
      if (db) {
        try {
          db.close();
        } catch (_err) {}
      }
      return {};
    }
  }
}

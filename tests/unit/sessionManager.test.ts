import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionManager } from '../../src/core/memory/sessionManager.js';

describe('SessionManager', () => {
  let tempDir: string;
  let manager: SessionManager;
  let originalSessionName: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-test-session-'));
    manager = new SessionManager(tempDir);
    originalSessionName = process.env.AURA_SESSION_NAME;
  });

  afterEach(() => {
    if (originalSessionName === undefined) {
      delete process.env.AURA_SESSION_NAME;
    } else {
      process.env.AURA_SESSION_NAME = originalSessionName;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_e) {}
  });

  it('can create a session and check existance', () => {
    expect(manager.exists('test-session')).toBe(false);
    const info = manager.create('test-session', {
      description: 'test description',
    });

    expect(info.name).toBe('test-session');
    expect(info.description).toBe('test description');
    expect(fs.existsSync(info.db_path)).toBe(true);

    expect(manager.exists('test-session')).toBe(true);
  });

  it('can list, rename, and delete sessions', () => {
    manager.create('s1');
    manager.create('s2');

    const list = manager.list();
    expect(list.map((s) => s.name)).toContain('s1');
    expect(list.map((s) => s.name)).toContain('s2');

    manager.rename('s1', 's3');
    expect(manager.exists('s1')).toBe(false);
    expect(manager.exists('s3')).toBe(true);

    manager.delete('s2');
    expect(manager.exists('s2')).toBe(false);
    expect(manager.list().map((s) => s.name)).toContain('s3');
  });

  it('can duplicate a session', () => {
    manager.create('src');
    manager.duplicate('src', 'dest');

    expect(manager.exists('dest')).toBe(true);
  });

  it('should validate session names and throw on invalid characters', () => {
    expect(() => manager.create('')).toThrow('Session name cannot be empty');
    expect(() => manager.create('   ')).toThrow('Session name cannot be empty');
    expect(() => manager.create('a/b')).toThrow(
      'Session name cannot contain path separators',
    );
    expect(() => manager.create('a\\b')).toThrow(
      'Session name cannot contain path separators',
    );
    expect(() => manager.create('a..b')).toThrow(
      "Session name cannot contain '..'",
    );
  });

  it('should throw when creating an already existing session', () => {
    manager.create('existing');
    expect(() => manager.create('existing')).toThrow(
      "Session 'existing' already exists",
    );
  });

  it('should track and activate current active session', () => {
    expect(manager.currentName()).toBeNull();
    expect(manager.currentDbPath()).toBeNull();

    expect(() => manager.activate('nonexistent')).toThrow(
      "Session 'nonexistent' does not exist",
    );

    manager.create('active');
    const dbPath = manager.activate('active');

    expect(manager.currentName()).toBe('active');
    expect(manager.currentDbPath()).toBe(dbPath);
    expect(process.env.AURA_SESSION_NAME).toBe('active');

    // Rename active session should reactivate it under new name
    manager.rename('active', 'new-active');
    expect(manager.currentName()).toBe('new-active');
  });

  it('should handle export and import of sessions', () => {
    manager.create('s-export');

    const destPath = path.join(tempDir, 'backups', 'backup.db');
    manager.export('s-export', destPath);

    expect(fs.existsSync(destPath)).toBe(true);

    // Import under new name
    const info = manager.import(destPath, 's-import');
    expect(info.name).toBe('s-import');
    expect(manager.exists('s-import')).toBe(true);

    // Import error cases
    expect(() => manager.import('nonexistent-file.db', 'new')).toThrow(
      "Source file 'nonexistent-file.db' does not exist",
    );
    expect(() => manager.import(destPath, 's-import')).toThrow(
      "Session 's-import' already exists",
    );
  });

  it('should auto-discover databases in sessions directory and handle database stats queries gracefully', () => {
    const sessionsDir = path.join(tempDir, 'state', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    // 1. Write an empty non-sqlite file (forces Database query throw error)
    const corruptDbPath = path.join(sessionsDir, 'corrupt.db');
    fs.writeFileSync(corruptDbPath, 'not-sqlite-format', 'utf-8');

    // 2. Write a valid sqlite database but with no tables (forces tableCheck to fail)
    const emptyDbPath = path.join(sessionsDir, 'empty-tables.db');
    const db = new Database(emptyDbPath);
    db.close();

    const list = manager.list({ includeMissing: true });
    const discoveredNames = list.map((s) => s.name);

    expect(discoveredNames).toContain('corrupt');
    expect(discoveredNames).toContain('empty-tables');

    // Since they have no events table or are corrupt, their stats should fall back to defaults
    const corruptInfo = list.find((s) => s.name === 'corrupt');
    expect(corruptInfo?.turn_count).toBe(0);
    expect(corruptInfo?.event_count).toBe(0);

    const emptyInfo = list.find((s) => s.name === 'empty-tables');
    expect(emptyInfo?.turn_count).toBe(0);
    expect(emptyInfo?.event_count).toBe(0);
  });

  it('should throw errors on duplicate and export for invalid sessions', () => {
    // 1. Duplicate source doesn't exist
    expect(() => manager.duplicate('nonexistent', 'dest')).toThrow(
      "Session 'nonexistent' does not exist",
    );

    // 2. Duplicate target already exists
    manager.create('s1');
    manager.create('s2');
    expect(() => manager.duplicate('s1', 's2')).toThrow(
      "Session 's2' already exists",
    );

    // 3. Export source doesn't exist
    expect(() => manager.export('nonexistent', 'some-path')).toThrow(
      "Session 'nonexistent' does not exist",
    );
  });
});

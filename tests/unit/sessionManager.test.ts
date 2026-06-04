import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SessionManager } from '../../src/core/memory/sessionManager.js';

describe('SessionManager', () => {
  let tempDir: string;
  let manager: SessionManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-test-session-'));
    manager = new SessionManager(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {}
  });

  it('can create a session and check existance', () => {
    expect(manager.exists('test-session')).toBe(false);
    const info = manager.create('test-session', { description: 'test description' });

    expect(info.name).toBe('test-session');
    expect(info.description).toBe('test description');
    expect(fs.existsSync(info.db_path)).toBe(true);

    expect(manager.exists('test-session')).toBe(true);
  });

  it('can list, rename, and delete sessions', () => {
    manager.create('s1');
    manager.create('s2');

    let list = manager.list();
    expect(list.map(s => s.name)).toContain('s1');
    expect(list.map(s => s.name)).toContain('s2');

    manager.rename('s1', 's3');
    expect(manager.exists('s1')).toBe(false);
    expect(manager.exists('s3')).toBe(true);

    manager.delete('s2');
    expect(manager.exists('s2')).toBe(false);
    expect(manager.list().map(s => s.name)).toContain('s3');
  });

  it('can duplicate a session', () => {
    manager.create('src');
    manager.duplicate('src', 'dest');

    expect(manager.exists('dest')).toBe(true);
  });
});

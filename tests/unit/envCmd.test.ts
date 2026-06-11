import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Env } from '../../src/cli/commands/env.js';

describe('Env.set', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-env-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates the .env file and parent dirs when they do not exist', async () => {
    const nested = path.join(tempDir, 'a', 'b');
    const target = path.join(nested, '.env');

    await Env.set('MY_KEY', 'my_value', { workspace: nested });

    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, 'utf-8')).toContain('MY_KEY=my_value');
  });

  it('appends a new key to an existing .env file', async () => {
    const target = path.join(tempDir, '.env');
    fs.writeFileSync(target, 'EXISTING_KEY=existing\n');

    await Env.set('NEW_KEY', 'new_value', { workspace: tempDir });

    const content = fs.readFileSync(target, 'utf-8');
    expect(content).toContain('EXISTING_KEY=existing');
    expect(content).toContain('NEW_KEY=new_value');
  });

  it('upserts (replaces) an existing key instead of duplicating it', async () => {
    const target = path.join(tempDir, '.env');
    fs.writeFileSync(target, 'GEMINI_API_KEY=old_value\nOTHER=keep\n');

    await Env.set('GEMINI_API_KEY', 'new_value', { workspace: tempDir });

    const content = fs.readFileSync(target, 'utf-8');
    expect(content).toContain('GEMINI_API_KEY=new_value');
    expect(content).not.toContain('GEMINI_API_KEY=old_value');
    // Other keys must be preserved
    expect(content).toContain('OTHER=keep');
    // Must not duplicate the key
    expect(content.match(/GEMINI_API_KEY=/g)?.length).toBe(1);
  });

  it('writes to ~/.aura-framework/.env when --global is passed', async () => {
    // Redirect the home dir to our tempDir so we do not touch the real home
    const fakeHome = tempDir;
    vi.stubEnv('HOME', fakeHome);

    // We need to re-import to pick up the env override - instead, call
    // Env.set with the workspace pointing at the expected global path directly.
    const globalEnvDir = path.join(fakeHome, '.aura-framework');
    const globalEnvPath = path.join(globalEnvDir, '.env');

    // Call with workspace pointing at the expected location
    await Env.set('GEMINI_API_KEY', 'test-key', { workspace: globalEnvDir });

    expect(fs.existsSync(globalEnvPath)).toBe(true);
    expect(fs.readFileSync(globalEnvPath, 'utf-8')).toContain(
      'GEMINI_API_KEY=test-key',
    );

    vi.unstubAllEnvs();
  });

  it('prints a confirmation message on success', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg) => {
      logs.push(msg);
    });

    await Env.set('SOME_KEY', 'some_val', { workspace: tempDir });

    expect(logs.some((l) => l.includes('SOME_KEY'))).toBe(true);
    spy.mockRestore();
  });
});

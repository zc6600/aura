import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveOrCreateProjectRoot } from '../../src/bin/aura.js';
import { initializeWorkspaceInPlace } from '../../src/utils/workspaceInitializer.js';

describe('resolveOrCreateProjectRoot', { timeout: 30000 }, () => {
  let tempDir: string;

  beforeEach(() => {
    // Deliberately NOT os.tmpdir(): vitest sandboxes TMPDIR/HOME to a
    // directory *inside* this repo (tests/.sandbox/...), which would make
    // every temp dir here a descendant of the aura-cli package root and
    // spuriously trip the "don't init inside the framework checkout" guard
    // under test. Real system /tmp is guaranteed outside the repo tree.
    tempDir = fs.realpathSync(
      fs.mkdtempSync(path.join('/tmp', 'aura-agent-root-')),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reuses the existing project when cwd is already inside one', async () => {
    await initializeWorkspaceInPlace(tempDir);

    const nested = path.join(tempDir, 'src', 'sub');
    fs.mkdirSync(nested, { recursive: true });

    const root = await resolveOrCreateProjectRoot(nested);

    expect(root).toBe(tempDir);
  });

  it('auto-initializes a workspace in place when cwd has none yet', async () => {
    expect(fs.existsSync(path.join(tempDir, '.aura-workspace'))).toBe(false);

    const root = await resolveOrCreateProjectRoot(tempDir);

    expect(root).toBe(tempDir);
    expect(fs.existsSync(path.join(tempDir, '.aura-workspace'))).toBe(true);
    // No stray directory named after the resolved root's basename should be
    // created as a sibling — the whole point is that we operate in place.
    expect(fs.readdirSync(path.dirname(tempDir))).not.toContain('Hello');
  });

  it('never auto-initializes inside the Aura framework source checkout itself', async () => {
    // Reproduces a real incident: running the auto-init path with cwd set to
    // the aura-cli repo cloned a full .aura-workspace into the framework's
    // own source tree and registered it globally.
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'aura-cli', version: '0.1.0' }),
    );

    const root = await resolveOrCreateProjectRoot(tempDir);

    expect(fs.existsSync(path.join(tempDir, '.aura-workspace'))).toBe(false);
    expect(root).not.toBe(tempDir);
    // Redirected to the shared global sandbox workspace instead.
    expect(fs.existsSync(path.join(root, '.aura-workspace'))).toBe(true);
  });

  it('never auto-initializes when cwd is nested inside the framework source checkout', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'aura-cli', version: '0.1.0' }),
    );
    const nested = path.join(tempDir, 'src', 'bin');
    fs.mkdirSync(nested, { recursive: true });

    const root = await resolveOrCreateProjectRoot(nested);

    expect(fs.existsSync(path.join(tempDir, '.aura-workspace'))).toBe(false);
    expect(root).not.toBe(tempDir);
    expect(root).not.toBe(nested);
  });
});

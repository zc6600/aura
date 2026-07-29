import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveOrCreateProjectRoot } from '../../src/bin/aura.js';
import { initializeWorkspaceInPlace } from '../../src/utils/workspaceInitializer.js';

describe('resolveOrCreateProjectRoot', { timeout: 30000 }, () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'aura-agent-root-')),
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
});

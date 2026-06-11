import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionCmd } from '../../src/cli/commands/session.js';
import * as PathResolver from '../../src/utils/pathResolver.js';

vi.mock('../../src/cli/ui.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/cli/ui.js')>(
    '../../src/cli/ui.js',
  );
  return {
    ...actual,
    printSuccess: vi.fn(),
    confirm: vi.fn(),
    SessionError: class SessionError extends Error {},
  };
});

describe('SessionCmd', () => {
  let tempDir: string;
  let mockHome: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-test-sessioncmd-'));
    mockHome = path.join(tempDir, 'home');
    fs.mkdirSync(mockHome, { recursive: true });

    // Mock os.homedir
    vi.spyOn(os, 'homedir').mockReturnValue(mockHome);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_e) {}
  });

  it('should fallback to global directory for read-only session list outside workspace', () => {
    // Mock resolveProjectPath to return null (not in a workspace)
    vi.spyOn(PathResolver, 'resolveProjectPath').mockReturnValue(null);

    // Ensure global session directory is created if needed
    const globalPath = path.join(mockHome, '.aura-framework', 'global');
    fs.mkdirSync(globalPath, { recursive: true });

    // Should not throw, and should print list info or "No sessions found"
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(() => SessionCmd.list()).not.toThrow();

    // Check that resolveProjectPath was called
    expect(PathResolver.resolveProjectPath).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('should throw SessionError for write operations outside workspace', async () => {
    // Mock resolveProjectPath to return null (not in a workspace)
    vi.spyOn(PathResolver, 'resolveProjectPath').mockReturnValue(null);

    // Call write operations and expect SessionError
    expect(() => SessionCmd.create('my-session')).toThrow(
      /Not in an Aura workspace/,
    );
    expect(() => SessionCmd.rename('old', 'new')).toThrow(
      /Not in an Aura workspace/,
    );
    expect(() => SessionCmd.duplicate('old', 'new')).toThrow(
      /Not in an Aura workspace/,
    );
    expect(() => SessionCmd.importSession('some-path', 'new')).toThrow(
      /Not in an Aura workspace/,
    );
    await expect(SessionCmd.deleteSession('old')).rejects.toThrow(
      /Not in an Aura workspace/,
    );
  });

  it('should resolve to the global environment directory when requireWorkspace is false and resolveProjectPath returns null', () => {
    vi.spyOn(PathResolver, 'resolveProjectPath').mockReturnValue(null);
    const sessionMgr = (SessionCmd as any).resolveSessionMgr(false);
    expect(sessionMgr.projectPath).toBe(
      path.resolve(mockHome, '.aura-framework', 'global'),
    );
  });
});

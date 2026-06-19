import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionManager } from '../../src/core/memory/sessionManager.js';
import { initializeWorkspaceInPlace } from '../../src/utils/workspaceInitializer.js';
import { rmRetry } from '../utils/rmRetry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const auraBinPath = path.resolve(__dirname, '../../src/bin/aura.ts');
const tsxLoaderPath = path.resolve(
  __dirname,
  '../../node_modules/tsx/dist/loader.mjs',
);

describe('CLI Agent Shell Integration', { timeout: 60_000 }, () => {
  let tempWorkspace: string;

  beforeEach(async () => {
    tempWorkspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'aura-temp-agent-shell-'),
    );
    await initializeWorkspaceInPlace(tempWorkspace);
  });

  afterEach(async () => {
    if (fs.existsSync(tempWorkspace)) {
      await rmRetry(tempWorkspace);
    }
  });

  function startAgentShell(args: string[] = [], env: NodeJS.ProcessEnv = {}) {
    return execa(
      process.execPath,
      ['--import', tsxLoaderPath, auraBinPath, 'agent', ...args],
      {
        cwd: tempWorkspace,
        stdin: 'pipe',
        reject: false,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          AURA_SILENCE_LLM_WARNINGS: '1',
          AURA_SILENCE_PLANNER_WARNINGS: '1',
          ...env,
        },
      },
    );
  }

  it('starts the daemon-backed interactive agent shell and exits with /exit', async () => {
    const child = startAgentShell();
    child.stdin?.write('/exit\n');
    child.stdin?.end();

    const res = await child;
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Aura Shell v');
    expect(res.stdout).toContain('[Daemon]');
    expect(res.stdout).toContain('Try "how does context work?"');
  });

  it('prints help in the local interactive shell', async () => {
    const child = startAgentShell(['--no-daemon']);
    child.stdin?.write('/help\n');
    child.stdin?.write('/exit\n');
    child.stdin?.end();

    const res = await child;
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Aura Shell v');
    expect(res.stdout).toContain('[Local]');
    expect(res.stdout).toContain('Available commands:');
    expect(res.stdout).toContain('/auto on/off');
  });

  it('switches to an existing session from the local interactive shell', async () => {
    const sessionMgr = new SessionManager(tempWorkspace);
    sessionMgr.create('user_info');

    const child = startAgentShell(['--no-daemon']);
    child.stdin?.write('/session user_info\n');
    child.stdin?.write('/exit\n');
    child.stdin?.end();

    const res = await child;
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(
      "Successfully switched and hot-loaded session 'user_info'!",
    );
    expect(res.stdout).toContain('user_info');
  });
});

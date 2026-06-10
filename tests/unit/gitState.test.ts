import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitState } from '../../src/core/kernel/gitState.js';

describe('GitState', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-gitstate-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should construct and resolve projectPath', () => {
    const gitState = new GitState(tempDir);
    expect((gitState as any).projectPath).toBe(path.resolve(tempDir));
  });

  it('should return immediately if not a git repository', async () => {
    const gitState = new GitState(tempDir);
    fs.writeFileSync(path.join(tempDir, 'a.txt'), 'hello');
    await expect(
      gitState.snapshot('write_file', true),
    ).resolves.toBeUndefined();
  });

  it('should return immediately if success is false', async () => {
    await execa('git', ['init'], { cwd: tempDir });
    const gitState = new GitState(tempDir);
    fs.writeFileSync(path.join(tempDir, 'a.txt'), 'hello');

    await gitState.snapshot('write_file', false);

    const { stdout } = await execa('git', ['status', '--porcelain'], {
      cwd: tempDir,
    });
    expect(stdout).toContain('?? a.txt');
  });

  it('should return immediately if there are no changes', async () => {
    await execa('git', ['init'], { cwd: tempDir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: tempDir });
    await execa('git', ['config', 'user.email', 'test@example.com'], {
      cwd: tempDir,
    });

    const gitState = new GitState(tempDir);
    await expect(
      gitState.snapshot('write_file', true),
    ).resolves.toBeUndefined();
  });

  it('should stage and commit changes successfully', async () => {
    await execa('git', ['init'], { cwd: tempDir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: tempDir });
    await execa('git', ['config', 'user.email', 'test@example.com'], {
      cwd: tempDir,
    });

    const gitState = new GitState(tempDir);
    fs.writeFileSync(path.join(tempDir, 'a.txt'), 'hello');

    await gitState.snapshot('write_file', true);

    const { stdout } = await execa('git', ['log', '-1', '--pretty=%s'], {
      cwd: tempDir,
    });
    expect(stdout).toBe('[Aura] Tool execution: write_file');
  });

  it('should handle git error exceptions gracefully', async () => {
    await execa('git', ['init'], { cwd: tempDir });
    const gitState = new GitState(tempDir);
    fs.writeFileSync(path.join(tempDir, 'a.txt'), 'hello');

    await gitState.snapshot('write_file', true);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeWorkspaceInPlace } from '../../src/utils/workspaceInitializer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const auraBinPath = path.resolve(__dirname, '../../src/bin/aura.ts');

describe('CLI git Subcommand Integration', { timeout: 30000 }, () => {
  let tempWorkspace: string;

  beforeEach(async () => {
    tempWorkspace = path.resolve(__dirname, `temp-cli-git-${Date.now()}`);
    fs.mkdirSync(tempWorkspace, { recursive: true });

    // Initialize workspace
    await initializeWorkspaceInPlace(tempWorkspace);

    const auraDir = path.join(tempWorkspace, '.aura-workspace');

    // Configure local git within the test repo
    await execa('git', ['init'], { cwd: auraDir });
    await execa('git', ['config', 'user.name', 'Aura Test'], { cwd: auraDir });
    await execa('git', ['config', 'user.email', 'test@aura.ai'], {
      cwd: auraDir,
    });
  });

  afterEach(() => {
    if (fs.existsSync(tempWorkspace)) {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
    }
  });

  it('test_git_vcs_pipeline', async () => {
    const auraDir = path.join(tempWorkspace, '.aura-workspace');

    // Check status
    const resStatus = await execa('npx', ['tsx', auraBinPath, 'status'], {
      cwd: tempWorkspace,
    });
    expect(resStatus.stdout).toContain('On branch');

    // Create a dummy custom tool file
    const toolDir = path.join(auraDir, 'tools');
    fs.mkdirSync(toolDir, { recursive: true });
    const toolFile = path.join(toolDir, 'my_tool.ts');
    fs.writeFileSync(toolFile, '// Dummy tool');

    // Stage changes
    const resAdd = await execa(
      'npx',
      ['tsx', auraBinPath, 'add', 'tools/my_tool.ts'],
      { cwd: tempWorkspace },
    );
    expect(resAdd.exitCode).toBe(0);

    // Commit changes
    const resCommit = await execa(
      'npx',
      ['tsx', auraBinPath, 'commit', '-m', 'add dummy tool'],
      { cwd: tempWorkspace },
    );
    expect(resCommit.exitCode).toBe(0);

    // Check status after commit (should be clean of that file)
    const resStatusAfter = await execa('npx', ['tsx', auraBinPath, 'status'], {
      cwd: tempWorkspace,
    });
    expect(resStatusAfter.stdout).not.toContain('tools/my_tool.ts');
  });
});

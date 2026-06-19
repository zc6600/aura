import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const auraBinPath = path.resolve(__dirname, '../../src/bin/aura.ts');

describe('CLI new Subcommand Integration', { timeout: 30000 }, () => {
  let tempWorkspace: string;

  beforeEach(() => {
    tempWorkspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'aura-temp-cli-new-'),
    );
  });

  afterEach(() => {
    if (fs.existsSync(tempWorkspace)) {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
    }
  });

  it('test_new_project_lifecycle', async () => {
    const projectPath = path.join(tempWorkspace, 'my_project');

    const res = await execa('npx', ['tsx', auraBinPath, 'new', projectPath]);
    expect(res.exitCode).toBe(0);

    expect(fs.existsSync(projectPath)).toBe(true);
    expect(fs.existsSync(path.join(projectPath, '.aura-workspace'))).toBe(true);
    expect(
      fs.existsSync(path.join(projectPath, '.aura-workspace', 'config')),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(projectPath, '.aura-workspace', 'config', 'config.yml'),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(projectPath, '.gitignore'))).toBe(true);

    const gitignore = fs.readFileSync(
      path.join(projectPath, '.gitignore'),
      'utf-8',
    );
    expect(gitignore).toContain('.aura-workspace/');
  });
});

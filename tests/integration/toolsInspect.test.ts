import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const auraBinPath = path.resolve(__dirname, '../../src/bin/aura.ts');

describe('CLI tools inspect Integration', { timeout: 30000 }, () => {
  let tempWorkspace: string;

  beforeEach(async () => {
    tempWorkspace = path.resolve(
      __dirname,
      `temp-cli-tools-inspect-${Date.now()}`,
    );
    fs.mkdirSync(tempWorkspace, { recursive: true });

    // Initialize workspace
    const res = await execa('npx', ['tsx', auraBinPath, 'new', tempWorkspace]);
    expect(res.exitCode).toBe(0);
  });

  afterEach(() => {
    if (fs.existsSync(tempWorkspace)) {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
    }
  });

  it('test_pretty_json_output', async () => {
    const res = await execa(
      'npx',
      ['tsx', auraBinPath, 'tools', 'inspect', 'inspect_tool', '--pretty'],
      { cwd: tempWorkspace },
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('"tool":');
    expect(res.stdout).toContain('inspect_tool');
  });

  it('test_human_output', async () => {
    const res = await execa(
      'npx',
      ['tsx', auraBinPath, 'tools', 'inspect', 'inspect_tool', '--human'],
      { cwd: tempWorkspace },
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Tool: inspect_tool');
    expect(res.stdout).toContain('Files:');
  });
});

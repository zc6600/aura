import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const auraBinPath = path.resolve(__dirname, '../../src/bin/aura.ts');

describe('CLI doctor and info Subcommands Integration', {
  timeout: 30000,
}, () => {
  let tempWorkspace: string;

  beforeEach(async () => {
    tempWorkspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'aura-temp-cli-doctor-'),
    );

    // Initialize workspace
    const res = await execa('npx', ['tsx', auraBinPath, 'new', tempWorkspace]);
    expect(res.exitCode).toBe(0);
  });

  afterEach(() => {
    if (fs.existsSync(tempWorkspace)) {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
    }
  });

  it('test_doctor_and_info_commands', async () => {
    // Run doctor command
    const resDoctor = await execa('npx', ['tsx', auraBinPath, 'doctor'], {
      cwd: tempWorkspace,
    });
    expect(resDoctor.exitCode).toBe(0);
    expect(resDoctor.stdout).toContain('Node:');
    expect(resDoctor.stdout).toContain('Git:');

    // Run info command
    const resInfo = await execa('npx', ['tsx', auraBinPath, 'info'], {
      cwd: tempWorkspace,
    });
    expect(resInfo.exitCode).toBe(0);
    expect(resInfo.stdout).toContain('Aura OS - System Information');
  });
});

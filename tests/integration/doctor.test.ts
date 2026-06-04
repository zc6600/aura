import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const auraBinPath = path.resolve(__dirname, '../../src/bin/aura.ts');

describe('CLI doctor and info Subcommands Integration', { timeout: 30000 }, () => {
  let tempWorkspace: string;

  beforeEach(async () => {
    tempWorkspace = path.resolve(__dirname, `temp-cli-doctor-${Date.now()}`);
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

  it('test_doctor_and_info_commands', async () => {
    // Run doctor command
    const resDoctor = await execa('npx', ['tsx', auraBinPath, 'doctor'], { cwd: tempWorkspace });
    expect(resDoctor.exitCode).toBe(0);
    expect(resDoctor.stdout).toContain('Node:');
    expect(resDoctor.stdout).toContain('Git:');

    // Run info command
    const resInfo = await execa('npx', ['tsx', auraBinPath, 'info'], { cwd: tempWorkspace });
    expect(resInfo.exitCode).toBe(0);
    expect(resInfo.stdout).toContain('Aura OS - System Information');
  });
});

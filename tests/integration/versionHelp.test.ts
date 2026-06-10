import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const auraBinPath = path.resolve(__dirname, '../../src/bin/aura.ts');

describe('CLI version and help integration', { timeout: 30000 }, () => {
  it('test_version_command', async () => {
    const res = await execa('npx', ['tsx', auraBinPath, 'version']);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Aura OS version:');
  });

  it('test_version_flags', async () => {
    const resShort = await execa('npx', ['tsx', auraBinPath, '-V']);
    expect(resShort.exitCode).toBe(0);
    expect(resShort.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);

    const resLong = await execa('npx', ['tsx', auraBinPath, '--version']);
    expect(resLong.exitCode).toBe(0);
    expect(resLong.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('test_help_flags', async () => {
    const resShort = await execa('npx', ['tsx', auraBinPath, '-h']);
    expect(resShort.exitCode).toBe(0);
    expect(resShort.stdout).toContain('Usage:');

    const resLong = await execa('npx', ['tsx', auraBinPath, '--help']);
    expect(resLong.exitCode).toBe(0);
    expect(resLong.stdout).toContain('Usage:');
  });

  it('test_empty_args_shows_help', async () => {
    const res = await execa('npx', ['tsx', auraBinPath], { reject: false });
    // Commander exits with 0 on help, or 1 if no command provided depending on config.
    // In our case it should print usage/help or show error. Let's assert output.
    expect(res.stdout + res.stderr).toContain('Usage:');
  });
});

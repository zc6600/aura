import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'yaml';
import { createCli } from '../../src/bin/aura.js';
import { rmRetry } from '../utils/rmRetry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Programmatic CLI run Integration Tests', { timeout: 30000 }, () => {
  let tempDir: string;
  let testGlobalRepo: string;
  let _testWorkspace: string;
  let origEnvRepo: string | undefined;

  beforeEach(() => {
    tempDir = path.resolve(__dirname, `temp-cli-run-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    testGlobalRepo = path.join(tempDir, 'global_repo');
    _testWorkspace = path.join(tempDir, 'my_project');

    fs.mkdirSync(path.join(testGlobalRepo, 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(testGlobalRepo, 'config', 'config.yml'),
      yaml.stringify({
        llm: { provider: 'local', model: 'gpt-4' },
      }),
    );

    origEnvRepo = process.env.AURA_GLOBAL_REPO_PATH;
    process.env.AURA_GLOBAL_REPO_PATH = testGlobalRepo;
  });

  afterEach(async () => {
    if (origEnvRepo !== undefined) {
      process.env.AURA_GLOBAL_REPO_PATH = origEnvRepo;
    } else {
      delete process.env.AURA_GLOBAL_REPO_PATH;
    }

    if (fs.existsSync(tempDir)) {
      await rmRetry(tempDir);
    }
  });

  async function executeCli(argv: string[], cwd: string = process.cwd()) {
    let stdoutData = '';
    let stderrData = '';

    const stdoutStream = new Writable({
      write(chunk, _encoding, callback) {
        stdoutData += chunk.toString();
        callback();
      },
    });

    const stderrStream = new Writable({
      write(chunk, _encoding, callback) {
        stderrData += chunk.toString();
        callback();
      },
    });

    const consoleLogSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args) => {
        stdoutData += `${args.join(' ')}\n`;
      });
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((...args) => {
        stderrData += `${args.join(' ')}\n`;
      });
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation((...args) => {
        stderrData += `${args.join(' ')}\n`;
      });

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd);

    try {
      const cli = createCli();
      const code = await cli.run(argv, {
        env: process.env,
        stdin: process.stdin,
        stdout: stdoutStream,
        stderr: stderrStream,
        colorDepth: 1,
      });

      return { code, stdout: stdoutData, stderr: stderrData };
    } finally {
      cwdSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    }
  }

  it('should run aura help programmatically', async () => {
    const { code, stdout } = await executeCli(['--help'], tempDir);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('aura new');
    expect(stdout).toContain('aura doctor');
  });

  it('should run aura version programmatically', async () => {
    const { code, stdout } = await executeCli(['version'], tempDir);
    expect(code).toBe(0);
    expect(stdout).toContain('Aura OS version:');
  });

  it('should run aura completion programmatically and dynamically generate completions', async () => {
    const { code, stdout } = await executeCli(['completion', 'zsh'], tempDir);
    expect(code).toBe(0);
    expect(stdout).toContain('#compdef aura');
    expect(stdout).toContain('kernel');
    expect(stdout).toContain('garden');
    expect(stdout).toContain('completion');

    const bashRes = await executeCli(['completion', 'bash'], tempDir);
    expect(bashRes.code).toBe(0);
    expect(bashRes.stdout).toContain('complete -F _aura aura');
    expect(bashRes.stdout).toContain('kernel');
  });

  it('should run aura config and catch WorkspaceError programmatically without crash', async () => {
    const { code, stdout } = await executeCli(
      ['config', 'some.key', 'some.val'],
      tempDir,
    );
    // Since we're not in an Aura workspace and global is not specified, it should fail
    expect(code).not.toBe(0);
    // It should print Tip
    expect(stdout).toContain('Tip: run `aura new .` to initialize a workspace');
  });
});

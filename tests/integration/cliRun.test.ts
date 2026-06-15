import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'yaml';
import { createCli } from '../../src/bin/aura.js';
import { rmRetry } from '../utils/rmRetry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const auraBinPath = path.resolve(__dirname, '../../src/bin/aura.ts');

describe('Programmatic CLI run Integration Tests', { timeout: 90000 }, () => {
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

  it('should support aura kernel run_call with swapped path-first arguments robustly', async () => {
    const projPath = path.join(tempDir, 'my_project');
    const { code: newCode } = await executeCli(['new', projPath], tempDir);
    expect(newCode).toBe(0);

    // Write a dummy tool
    const toolDir = path.join(
      projPath,
      '.aura-workspace',
      'tools',
      'dummy_test',
    );
    fs.mkdirSync(toolDir, { recursive: true });
    fs.writeFileSync(
      path.join(toolDir, 'manifest.json'),
      JSON.stringify(
        {
          name: 'dummy_test',
          description: 'Dummy tool for CLI run_call test',
          runtime: 'python',
          entry: 'logic.py',
          input_schema: {
            type: 'object',
            properties: {
              val: { type: 'string' },
            },
            required: ['val'],
          },
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(toolDir, 'logic.py'),
      '#!/usr/bin/env python\nimport sys, json\nargs = json.loads(sys.stdin.read())\nprint(json.dumps({"status": "ok", "output": f"value: {args.get(\'val\')}"}))\n',
    );

    // Call normally: aura kernel run_call <tool> <args> <path>
    const resNormal = await executeCli(
      ['kernel', 'run_call', 'dummy_test', '{"val": "hello"}', projPath],
      projPath,
    );
    expect(resNormal.code).toBe(0);
    expect(resNormal.stdout).toContain('value: hello');

    // Call swapped: aura kernel run_call <path> <tool> <args>
    const resSwapped = await executeCli(
      ['kernel', 'run_call', projPath, 'dummy_test', '{"val": "world"}'],
      projPath,
    );
    expect(resSwapped.code).toBe(0);
    expect(resSwapped.stdout).toContain('value: world');
  });

  it('should implement source root protection for restricted commands', async () => {
    // Write package.json with name "aura-cli" to tempDir (which mimics the source root)
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'aura-cli', version: '0.1.0' }),
    );

    // 1. Restricted command should be blocked
    const resBlocked = await execa('npx', ['tsx', auraBinPath, 'status'], {
      cwd: tempDir,
      reject: false,
    });
    expect(resBlocked.exitCode).toBe(1);
    expect(resBlocked.stderr).toContain(
      'Security Check: Running restricted command inside the Aura framework source root is not allowed.',
    );

    // 2. Whitelisted command should be allowed
    const resWhitelisted = await execa('npx', ['tsx', auraBinPath, 'doctor'], {
      cwd: tempDir,
      reject: false,
    });
    // Doctor command might fail due to env issues, but it shouldn't be blocked by security check
    expect(resWhitelisted.stderr + resWhitelisted.stdout).not.toContain(
      'Security Check',
    );

    // 3. Bypass with --allow-root option
    const resBypassedOpt = await execa(
      'npx',
      ['tsx', auraBinPath, 'status', '--allow-root'],
      {
        cwd: tempDir,
        reject: false,
      },
    );
    expect(resBypassedOpt.stderr + resBypassedOpt.stdout).not.toContain(
      'Security Check',
    );

    // 4. Bypass with AURA_ALLOW_ROOT environment variable
    const resBypassedEnv = await execa('npx', ['tsx', auraBinPath, 'status'], {
      cwd: tempDir,
      reject: false,
      env: {
        ...process.env,
        AURA_ALLOW_ROOT: 'true',
      },
    });
    expect(resBypassedEnv.stderr + resBypassedEnv.stdout).not.toContain(
      'Security Check',
    );
  });
});

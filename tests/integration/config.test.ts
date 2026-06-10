import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { initializeWorkspaceInPlace } from '../../src/utils/workspaceInitializer.js';
import { rmRetry } from '../utils/rmRetry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const auraBinPath = path.resolve(__dirname, '../../src/bin/aura.ts');

describe('CLI config Subcommand Integration', { timeout: 60000 }, () => {
  let tempDir: string;
  let testGlobalRepo: string;
  let testWorkspace: string;
  let origEnvRepo: string | undefined;
  let origForceColor: string | undefined;
  let origNoColor: string | undefined;

  beforeEach(async () => {
    tempDir = path.resolve(__dirname, `temp-cli-config-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    testGlobalRepo = path.join(tempDir, 'global_repo');
    testWorkspace = path.join(tempDir, 'my_project');

    fs.mkdirSync(path.join(testGlobalRepo, 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(testGlobalRepo, 'config', 'config.yml'),
      yaml.stringify({
        llm: { provider: 'local', model: 'gpt-4' },
      }),
    );

    // Isolate repo path env variable
    origEnvRepo = process.env.AURA_GLOBAL_REPO_PATH;
    process.env.AURA_GLOBAL_REPO_PATH = testGlobalRepo;

    // Disable colors to prevent stdout mismatch due to terminal colors
    origForceColor = process.env.FORCE_COLOR;
    delete process.env.FORCE_COLOR;
    origNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';

    // Initialize workspace
    await initializeWorkspaceInPlace(testWorkspace);
  });

  afterEach(async () => {
    if (origEnvRepo !== undefined) {
      process.env.AURA_GLOBAL_REPO_PATH = origEnvRepo;
    } else {
      delete process.env.AURA_GLOBAL_REPO_PATH;
    }

    if (origForceColor !== undefined) {
      process.env.FORCE_COLOR = origForceColor;
    } else {
      delete process.env.FORCE_COLOR;
    }

    if (origNoColor !== undefined) {
      process.env.NO_COLOR = origNoColor;
    } else {
      delete process.env.NO_COLOR;
    }

    if (fs.existsSync(tempDir)) {
      await rmRetry(tempDir);
    }
  });

  it('test_local_config_outside_workspace', async () => {
    // Run outside workspace and expect failure
    const res = await execa(
      'npx',
      ['tsx', auraBinPath, 'config', 'some.key', 'some_value'],
      {
        cwd: tempDir,
        reject: false,
      },
    );
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain('Not in an Aura workspace');
  });

  it('test_config_type_parsing', async () => {
    // Set config values
    await execa(
      'npx',
      ['tsx', auraBinPath, 'config', 'security.strict_path_isolation', 'true'],
      { cwd: testWorkspace },
    );
    await execa(
      'npx',
      ['tsx', auraBinPath, 'config', 'security.sandbox.enabled', 'false'],
      { cwd: testWorkspace },
    );
    await execa(
      'npx',
      [
        'tsx',
        auraBinPath,
        'config',
        'state_management.max_state_chars',
        '5000',
      ],
      { cwd: testWorkspace },
    );
    await execa(
      'npx',
      ['tsx', auraBinPath, 'config', 'llm.temperature', '0.85'],
      { cwd: testWorkspace },
    );
    await execa(
      'npx',
      ['tsx', auraBinPath, 'config', 'llm.provider', 'openai'],
      { cwd: testWorkspace },
    );

    // Read back single values
    const outTrue = await execa(
      'npx',
      ['tsx', auraBinPath, 'config', 'security.strict_path_isolation'],
      { cwd: testWorkspace },
    );
    expect(outTrue.stdout.trim()).toBe('true');

    const outFalse = await execa(
      'npx',
      ['tsx', auraBinPath, 'config', 'security.sandbox.enabled'],
      { cwd: testWorkspace },
    );
    expect(outFalse.stdout.trim()).toBe('false');

    const outInt = await execa(
      'npx',
      ['tsx', auraBinPath, 'config', 'state_management.max_state_chars'],
      { cwd: testWorkspace },
    );
    expect(outInt.stdout.trim()).toBe('5000');

    const outFloat = await execa(
      'npx',
      ['tsx', auraBinPath, 'config', 'llm.temperature'],
      { cwd: testWorkspace },
    );
    expect(outFloat.stdout.trim()).toBe('0.85');

    const outStr = await execa(
      'npx',
      ['tsx', auraBinPath, 'config', 'llm.provider'],
      { cwd: testWorkspace },
    );
    expect(outStr.stdout.trim()).toBe('openai');

    // Verify raw YAML file contents
    const localCfgPath = path.join(
      testWorkspace,
      '.aura',
      'config',
      'config.yml',
    );
    const localCfg = yaml.parse(fs.readFileSync(localCfgPath, 'utf-8'));

    expect(localCfg.security.strict_path_isolation).toBe(true);
    expect(localCfg.security.sandbox.enabled).toBe(false);
    expect(localCfg.state_management.max_state_chars).toBe(5000);
    expect(localCfg.llm.temperature).toBe(0.85);
    expect(localCfg.llm.provider).toBe('openai');
  });

  it('test_config_non_existent_key', async () => {
    const res = await execa(
      'npx',
      ['tsx', auraBinPath, 'config', 'non.existent.key'],
      { cwd: testWorkspace },
    );
    expect(res.stdout.trim()).toBe('(nil)');
  });

  it('test_config_list_all', async () => {
    const res = await execa('npx', ['tsx', auraBinPath, 'config'], {
      cwd: testWorkspace,
    });
    const parsed = yaml.parse(res.stdout);
    expect(parsed.project_name).toBe('my_project');
  });

  it('test_global_config_write_and_read', async () => {
    // Write and read with --global flag outside a workspace
    const resWrite = await execa(
      'npx',
      ['tsx', auraBinPath, 'config', 'llm.provider', 'anthropic', '--global'],
      { cwd: tempDir },
    );
    expect(resWrite.exitCode).toBe(0);

    const resRead = await execa(
      'npx',
      ['tsx', auraBinPath, 'config', 'llm.provider', '--global'],
      { cwd: tempDir },
    );
    expect(resRead.stdout.trim()).toBe('anthropic');

    const globalCfg = yaml.parse(
      fs.readFileSync(
        path.join(testGlobalRepo, 'config', 'config.yml'),
        'utf-8',
      ),
    );
    expect(globalCfg.llm.provider).toBe('anthropic');
  });
});

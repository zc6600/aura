import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configPath,
  ensureRepo,
  gitRun,
  repoPath,
} from '../../src/utils/globalConfig.js';

// Top-level variables prefixed with "mock" to be accessible inside hoisted vi.mock
let mockHomePath = '';
let mockExecaShouldFail = false;

// Mock node:os
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  const mockHomedir = () => mockHomePath;
  return {
    ...actual,
    homedir: mockHomedir,
    default: {
      ...(actual as any).default,
      homedir: mockHomedir,
    },
  };
});

// Mock execa
vi.mock('execa', () => {
  return {
    execa: vi.fn(async (_cmd, _args) => {
      if (mockExecaShouldFail) {
        throw new Error('Mocked execa error');
      }
      return { stdout: 'mock-stdout', stderr: 'mock-stderr' };
    }),
  };
});

describe('globalConfig', () => {
  let tempDir: string;
  let mockHome: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'aura-test-global-config-'),
    );
    mockHome = path.join(tempDir, 'home');
    fs.mkdirSync(mockHome, { recursive: true });
    mockHomePath = mockHome;
    mockExecaShouldFail = false;

    originalEnv = {
      AURA_HOME: process.env.AURA_HOME,
      AURA_GLOBAL_REPO_PATH: process.env.AURA_GLOBAL_REPO_PATH,
    };
    process.env.AURA_HOME = path.join(mockHome, '.aura-framework');
    delete process.env.AURA_GLOBAL_REPO_PATH;
  });

  afterEach(() => {
    mockExecaShouldFail = false;
    if (originalEnv) {
      for (const key of Object.keys(originalEnv)) {
        if (originalEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = originalEnv[key];
        }
      }
    }
    vi.restoreAllMocks();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_e) {}
  });

  it('should resolve configPath and repoPath from homedir', () => {
    expect(configPath()).toBe(
      path.join(mockHome, '.aura-framework', 'config.yml'),
    );
    expect(repoPath()).toBe(path.join(mockHome, '.aura-framework', 'repo'));
  });

  it('should override repoPath with environment variable', () => {
    const customRepo = path.join(tempDir, 'custom-repo');
    process.env.AURA_GLOBAL_REPO_PATH = customRepo;
    expect(repoPath()).toBe(customRepo);
  });

  it('should execute git command and return stdout/stderr on gitRun', async () => {
    const res = await gitRun(tempDir, 'status');
    expect(res.success).toBe(true);
    expect(res.stdout).toBe('mock-stdout');
    expect(res.stderr).toBe('mock-stderr');
  });

  it('should catch execa throw and return success=false on gitRun', async () => {
    mockExecaShouldFail = true;
    const res = await gitRun(tempDir, 'status');
    expect(res.success).toBe(false);
    expect(res.stderr).toContain('Mocked execa error');
  });

  it('should handle config migration in ensureRepo', async () => {
    const repoDir = repoPath();
    fs.mkdirSync(repoDir, { recursive: true });

    // Create a legacy config.yml inside repo
    const legacyConfig = path.join(repoDir, 'config.yml');
    const legacyData = `
llm:
  model: local
state_management:
  persistence: memory
ralph:
  loop_limit: 5
`;
    fs.writeFileSync(legacyConfig, legacyData, 'utf-8');

    // Create an existing target config.yml that we will merge overrides on top of
    const targetConfigDir = path.join(repoDir, 'config');
    fs.mkdirSync(targetConfigDir, { recursive: true });
    const targetConfig = path.join(targetConfigDir, 'config.yml');
    const existingTargetData = `
llm:
  model: anthropic
  temp: 0.7
state_management:
  persistence: sqlite
  sync: true
ralph:
  loop_limit: 10
  history: true
`;
    fs.writeFileSync(targetConfig, existingTargetData, 'utf-8');

    // Make sure .git folder exists to cover git add/commit logic in ensureRepo
    fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });

    // Call ensureRepo()
    await ensureRepo();

    // Check if legacy config was migrated and unlinked
    expect(fs.existsSync(legacyConfig)).toBe(false);
    expect(fs.existsSync(targetConfig)).toBe(true);

    // Read the merged yaml and verify deep merge values
    const mergedRaw = fs.readFileSync(targetConfig, 'utf-8');
    expect(mergedRaw).toContain('model: anthropic'); // user override wins
    expect(mergedRaw).toContain('temp: 0.7'); // user override kept
    expect(mergedRaw).toContain('persistence: sqlite'); // user override wins
    expect(mergedRaw).toContain('sync: true'); // user override kept
    expect(mergedRaw).toContain('loop_limit: 10'); // user override wins
    expect(mergedRaw).toContain('history: true'); // user override kept
  });

  it('should handle rename migration in ensureRepo when target does not exist', async () => {
    const repoDir = repoPath();
    fs.mkdirSync(repoDir, { recursive: true });

    // Legacy config exists, but config/config.yml does not
    const legacyConfig = path.join(repoDir, 'config.yml');
    fs.writeFileSync(legacyConfig, 'model: test\n', 'utf-8');

    // Make sure .git folder exists to bypass copy templates
    fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });

    await ensureRepo();

    expect(fs.existsSync(legacyConfig)).toBe(false);
    const targetConfig = path.join(repoDir, 'config', 'config.yml');
    expect(fs.existsSync(targetConfig)).toBe(true);
    expect(fs.readFileSync(targetConfig, 'utf-8')).toBe('model: test\n');
  });

  it("should fallback templates copy path when gemTemplates doesn't exist", async () => {
    // Calling ensureRepo when repo is NOT initialized yet
    // This will trigger initial repository clone or templates copy
    await ensureRepo();

    const repoDir = repoPath();
    expect(fs.existsSync(path.join(repoDir, '.git'))).toBe(false); // since git run is mocked
    // Verify that copy occurred and repo directory is created
    expect(fs.existsSync(repoDir)).toBe(true);
  });
});

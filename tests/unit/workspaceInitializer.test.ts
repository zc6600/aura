import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as UI from '../../src/cli/ui.js';
import * as ConfigManager from '../../src/utils/configManager.js';
import {
  handleNoWorkspace,
  initializeGlobalEnv,
  initializeSandbox,
  initializeWorkspaceInPlace,
  resolveProjectPath,
  safeLoadYaml,
} from '../../src/utils/workspaceInitializer.js';

// Top-level variables prefixed with "mock" to be accessible inside hoisted vi.mock
let mockHomePath = '';
let mockExecaShouldFail = false;

function isolatedTmpRoot(): string {
  if (process.platform !== 'win32' && fs.existsSync('/tmp')) {
    return fs.realpathSync('/tmp');
  }
  return os.tmpdir();
}

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

// Mock UI
vi.mock('../../src/cli/ui.js', () => {
  return {
    confirm: vi.fn(),
    CliError: class CliError extends Error {},
  };
});

// Mock execa
vi.mock('execa', () => {
  return {
    execa: vi.fn(async (cmd, args) => {
      if (mockExecaShouldFail) {
        throw new Error('Mocked execa error');
      }
      // Mock git clone behavior: create target directory and write dummy files
      if (cmd === 'git' && args[0] === 'clone') {
        const targetDir = args[2];
        fs.mkdirSync(targetDir, { recursive: true });
        const configDir = path.join(targetDir, 'config');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yml'),
          'project_name: template\n',
          'utf-8',
        );
      }
      return { stdout: '', stderr: '' };
    }),
  };
});

describe('workspaceInitializer', () => {
  let tempDir: string;
  let mockHome: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(isolatedTmpRoot(), 'aura-test-workspace-init-'),
    );
    mockHome = path.join(tempDir, 'home');
    fs.mkdirSync(mockHome, { recursive: true });

    // Set the path for the mocked os.homedir()
    mockHomePath = mockHome;
    mockExecaShouldFail = false;

    originalEnv = {
      NODE_ENV: process.env.NODE_ENV,
      CI: process.env.CI,
      AURA_HOME: process.env.AURA_HOME,
      AURA_GLOBAL_REPO_PATH: process.env.AURA_GLOBAL_REPO_PATH,
      AURA_GLOBAL_PROJECTS_CONFIG_PATH:
        process.env.AURA_GLOBAL_PROJECTS_CONFIG_PATH,
    };

    // Set paths relative to mockHome
    process.env.AURA_HOME = path.join(mockHome, '.aura-framework');
    process.env.AURA_GLOBAL_REPO_PATH = path.join(
      mockHome,
      '.aura-framework',
      'repo',
    );
    process.env.AURA_GLOBAL_PROJECTS_CONFIG_PATH = path.join(
      mockHome,
      '.aura-framework',
      'projects.yml',
    );
  });

  afterEach(() => {
    mockExecaShouldFail = false;
    // Restore environment
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

  describe('safeLoadYaml', () => {
    it('should return empty object for non-existent file', () => {
      const result = safeLoadYaml(path.join(tempDir, 'nonexistent.yml'));
      expect(result).toEqual({});
    });

    it('should return empty object for invalid YAML', () => {
      const invalidFile = path.join(tempDir, 'invalid.yml');
      fs.writeFileSync(invalidFile, 'invalid: : YAML:', 'utf-8');
      const result = safeLoadYaml(invalidFile);
      expect(result).toEqual({});
    });

    it('should load valid YAML successfully', () => {
      const validFile = path.join(tempDir, 'valid.yml');
      fs.writeFileSync(
        validFile,
        'name: test-workspace\nversion: 1.0\n',
        'utf-8',
      );
      const result = safeLoadYaml(validFile);
      expect(result).toEqual({ name: 'test-workspace', version: 1.0 });
    });
  });

  describe('resolveProjectPath', () => {
    it('should resolve direct path if it contains .aura-workspace directory', async () => {
      const projectPath = path.join(tempDir, 'my-project');
      fs.mkdirSync(path.join(projectPath, '.aura-workspace'), {
        recursive: true,
      });

      const resolved = await resolveProjectPath(projectPath);
      expect(resolved).toBe(path.resolve(projectPath));
    });

    it('should resolve workspace path by climbing directories', async () => {
      const projectPath = path.join(tempDir, 'my-project');
      const subDir = path.join(projectPath, 'src', 'components');
      fs.mkdirSync(path.join(projectPath, '.aura-workspace'), {
        recursive: true,
      });
      fs.mkdirSync(subDir, { recursive: true });

      const resolved = await resolveProjectPath(subDir);
      expect(resolved).toBe(path.resolve(projectPath));
    });

    it('should fall back to sandbox if not in workspace in test environment', async () => {
      process.env.NODE_ENV = 'test';
      const nonexistentPath = path.join(tempDir, 'no-aura-here');

      const resolved = await resolveProjectPath(nonexistentPath);
      // Under test/CI env handleNoWorkspace defaults to sandbox
      expect(resolved).toBe(path.join(mockHome, '.aura-framework', 'sandbox'));
    });
  });

  describe('handleNoWorkspace', () => {
    it('should prompt user in non-test environment and resolve to sandbox if confirmed no', async () => {
      process.env.NODE_ENV = 'production';
      process.env.CI = 'false';

      vi.mocked(UI.confirm).mockResolvedValue(false); // confirm workspace in place = false

      const startDir = path.join(tempDir, 'some-dir');
      const resolved = await handleNoWorkspace(startDir);
      expect(resolved).toBe(path.join(mockHome, '.aura-framework', 'sandbox'));
      expect(UI.confirm).toHaveBeenCalled();
    });

    it('should prompt user in non-test environment and initialize in-place if confirmed yes', async () => {
      process.env.NODE_ENV = 'production';
      process.env.CI = 'false';

      vi.mocked(UI.confirm).mockResolvedValue(true); // confirm workspace in place = true

      const startDir = path.join(tempDir, 'some-dir');
      fs.mkdirSync(startDir, { recursive: true });

      const resolved = await handleNoWorkspace(startDir);
      expect(resolved).toBe(path.resolve(startDir));
      expect(UI.confirm).toHaveBeenCalled();
      expect(fs.existsSync(path.join(startDir, '.aura-workspace'))).toBe(true);
    });
  });

  describe('initializeSandbox', () => {
    it('should initialize sandbox and create correct file structure', async () => {
      const sandboxPath = await initializeSandbox();
      expect(sandboxPath).toBe(
        path.join(mockHome, '.aura-framework', 'sandbox'),
      );
      expect(fs.existsSync(path.join(sandboxPath, '.aura-workspace'))).toBe(
        true,
      );
      expect(
        fs.existsSync(
          path.join(sandboxPath, '.aura-workspace', 'config', 'config.yml'),
        ),
      ).toBe(true);
    });

    it('should bubble up error as CliError on execa clone failure', async () => {
      mockExecaShouldFail = true;
      await expect(initializeSandbox()).rejects.toThrow(UI.CliError);
    });
  });

  describe('initializeWorkspaceInPlace', () => {
    it('should initialize workspace in place and configure project name', async () => {
      const workspacePath = path.join(tempDir, 'my-workspace');
      fs.mkdirSync(workspacePath, { recursive: true });

      const resolved = await initializeWorkspaceInPlace(workspacePath);
      expect(resolved).toBe(path.resolve(workspacePath));
      expect(fs.existsSync(path.join(workspacePath, '.gitignore'))).toBe(true);
      expect(
        fs.readFileSync(path.join(workspacePath, '.gitignore'), 'utf-8'),
      ).toContain('.aura-workspace/');
    });

    it('should inject correct ignore rules inside .gitignore in .aura folder', async () => {
      const workspacePath = path.join(tempDir, 'my-workspace');
      fs.mkdirSync(workspacePath, { recursive: true });

      await initializeWorkspaceInPlace(workspacePath);
      const innerGitignore = path.join(
        workspacePath,
        '.aura-workspace',
        '.gitignore',
      );
      expect(fs.existsSync(innerGitignore)).toBe(true);
      const content = fs.readFileSync(innerGitignore, 'utf-8');
      expect(content).toContain('state/aura.db*');
      expect(content).toContain('state/**/*.db*');
      expect(content).toContain('state/sessions/');
      expect(content).toContain('state/chat_sessions/');
    });

    it('should bubble up error as CliError on clone failure', async () => {
      mockExecaShouldFail = true;
      await expect(initializeWorkspaceInPlace(tempDir)).rejects.toThrow(
        UI.CliError,
      );
    });
  });

  describe('initializeGlobalEnv', () => {
    it('should initialize global environment correctly', async () => {
      const globalEnvPath = await initializeGlobalEnv();
      expect(globalEnvPath).toBe(
        path.join(mockHome, '.aura-framework', 'global'),
      );
      expect(fs.existsSync(globalEnvPath)).toBe(true);
    });

    it('should bubble up error as CliError on init failure', async () => {
      mockExecaShouldFail = true;
      await expect(initializeGlobalEnv()).rejects.toThrow(UI.CliError);
    });
  });

  describe('edge cases and catch blocks', () => {
    it('should fall back to aura_workspace when projectName is empty after sanitization', async () => {
      const specialPath = path.join(tempDir, '.@#$');
      fs.mkdirSync(specialPath, { recursive: true });

      const resolved = await initializeWorkspaceInPlace(specialPath);
      expect(resolved).toBe(path.resolve(specialPath));

      const { registeredProjects } = await import(
        '../../src/utils/projectRegistry.js'
      );
      expect(registeredProjects()).toHaveProperty('aura_workspace');
    });

    it('should catch configuration save errors gracefully', async () => {
      const writeSpy = vi
        .spyOn(ConfigManager, 'write')
        .mockImplementation(() => {
          throw new Error('Mock write error');
        });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const sandboxPath = await initializeSandbox();
      expect(sandboxPath).toBeDefined();
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
      writeSpy.mockRestore();
    });
  });
});

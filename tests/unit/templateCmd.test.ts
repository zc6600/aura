import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Template } from '../../src/cli/commands/template.js';
import * as GlobalConfig from '../../src/utils/globalConfig.js';

// Mock execa to avoid running real git process details
vi.mock('execa', () => {
  return {
    execa: vi.fn(async () => {
      return { stdout: '', stderr: '' };
    }),
  };
});

describe('Template.sync', () => {
  let tempDir: string;
  let mockRepoDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-template-test-'));
    mockRepoDir = path.join(tempDir, 'repo');
    fs.mkdirSync(mockRepoDir, { recursive: true });

    // Mock GlobalConfig.repoPath and gitRun
    vi.spyOn(GlobalConfig, 'repoPath').mockReturnValue(mockRepoDir);
    vi.spyOn(GlobalConfig, 'gitRun').mockResolvedValue({
      stdout: '',
      stderr: '',
      success: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should preserve and merge user global config overrides during template sync', async () => {
    const configDir = path.join(mockRepoDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, 'config.yml');

    // 1. Write an initial global config containing user overrides
    const initialConfig = `
llm:
  provider: gemini
  model: gemini-2.5-flash
security:
  strict_path_isolation: false
`;
    fs.writeFileSync(configPath, initialConfig, 'utf-8');

    // 2. Run template sync
    await Template.sync();

    // 3. Verify config file exists and contains merged settings
    expect(fs.existsSync(configPath)).toBe(true);

    const mergedContent = fs.readFileSync(configPath, 'utf-8');
    // Verify user overrides were preserved & merged on top of new templates
    expect(mergedContent).toContain('provider: gemini');
    expect(mergedContent).toContain('model: gemini-2.5-flash');
    expect(mergedContent).toContain('strict_path_isolation: false');
  });
});

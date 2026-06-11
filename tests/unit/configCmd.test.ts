import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Config } from '../../src/cli/commands/config.js';

// Helpers to build a minimal fake global repo layout
function makeGlobalRepo(baseDir: string): string {
  const repoDir = path.join(baseDir, 'repo');
  const configDir = path.join(repoDir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  // Minimal config.yml
  fs.writeFileSync(
    path.join(configDir, 'config.yml'),
    'llm:\n  provider: openai\n  model: gpt-4o\n',
  );
  return repoDir;
}

describe('Config.run', () => {
  let tempDir: string;
  let repoDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-config-test-'));
    repoDir = makeGlobalRepo(tempDir);

    // Point AURA_GLOBAL_REPO_PATH to our fake repo so Config uses it
    process.env.AURA_GLOBAL_REPO_PATH = repoDir;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.AURA_GLOBAL_REPO_PATH;
  });

  it('silently ignores llm.api_key — does not write it to config.yml', async () => {
    const configPath = path.join(repoDir, 'config', 'config.yml');
    const before = fs.readFileSync(configPath, 'utf-8');

    // Should not throw and should produce no output
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await Config.run('llm.api_key', 'sk-secret-key', { global: true });
    consoleSpy.mockRestore();

    const after = fs.readFileSync(configPath, 'utf-8');
    // File must be unchanged
    expect(after).toBe(before);
    // Must not contain the key
    expect(after).not.toContain('api_key');
    expect(after).not.toContain('sk-secret-key');
  });

  it('writes non-secret config keys (e.g. llm.provider) to config.yml', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await Config.run('llm.provider', 'anthropic', { global: true });
    consoleSpy.mockRestore();

    const configPath = path.join(repoDir, 'config', 'config.yml');
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('anthropic');
  });

  it('reads a config value back correctly', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((v) => logs.push(String(v)));

    await Config.run('llm.provider', undefined, { global: true });

    expect(logs.some((l) => l.includes('openai'))).toBe(true);
    vi.restoreAllMocks();
  });
});

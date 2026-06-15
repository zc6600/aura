import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'yaml';
import { ExecutionEngine } from '../../src/core/kernel/executionEngine.js';
import { NarrativeService } from '../../src/core/kernel/narrativeService.js';
import { ShadowBackup } from '../../src/core/kernel/shadowBackup.js';
import { LLMClient } from '../../src/core/llm/client.js';
import * as PathResolver from '../../src/utils/pathResolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const auraBinPath = path.resolve(__dirname, '../../src/bin/aura.ts');
process.env.AURA_ALLOW_ROOT = 'true';

describe('Miscellaneous Integration', { timeout: 40000 }, () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'aura-misc-integration-'),
    );

    // Initialize workspace
    const res = await execa('npx', ['tsx', auraBinPath, 'new', projectPath]);
    expect(res.exitCode).toBe(0);
  }, 30000);

  afterEach(() => {
    try {
      if (fs.existsSync(projectPath)) {
        fs.rmSync(projectPath, { recursive: true, force: true });
      }
    } catch (_e) {}
  });

  // --- 1. ShadowBackup ---
  describe('ShadowBackup', () => {
    it('creates git repo, copies files, and respects ignores', async () => {
      // Setup parent git repo in projectPath
      await execa('git', ['init'], { cwd: projectPath });
      await execa('git', ['config', 'user.name', 'Test User'], {
        cwd: projectPath,
      });
      await execa('git', ['config', 'user.email', 'test@user.com'], {
        cwd: projectPath,
      });

      // Create a tracked dummy file
      const testFile = path.join(projectPath, 'test.txt');
      fs.writeFileSync(testFile, 'Hello original');
      await execa('git', ['add', 'test.txt'], { cwd: projectPath });
      await execa('git', ['commit', '-m', 'Initial commit'], {
        cwd: projectPath,
      });

      // Modify the file
      fs.writeFileSync(testFile, 'Hello modified');

      // Create large file
      const largeFile = path.join(projectPath, 'large.dat');
      fs.writeFileSync(largeFile, 'A'.repeat(1024 * 1024 + 100)); // >1MB

      // Create ignored file
      fs.writeFileSync(path.join(projectPath, '.gitignore'), 'ignored.txt\n');
      const ignoredFile = path.join(projectPath, 'ignored.txt');
      fs.writeFileSync(ignoredFile, 'Secret content');

      // Record changes
      const backup = new ShadowBackup(projectPath);
      await backup.recordChanges('write_file', { file_path: 'test.txt' });

      // Verify shadow directory
      const shadowPath = path.join(projectPath, '.aura-workspace', 'shadow');
      expect(fs.existsSync(shadowPath)).toBe(true);
      expect(fs.existsSync(path.join(shadowPath, '.git'))).toBe(true);

      // Verify modified file was copied
      expect(fs.readFileSync(path.join(shadowPath, 'test.txt'), 'utf-8')).toBe(
        'Hello modified',
      );

      // Verify large and ignored files were NOT copied
      expect(fs.existsSync(path.join(shadowPath, 'large.dat'))).toBe(false);
      expect(fs.existsSync(path.join(shadowPath, 'ignored.txt'))).toBe(false);

      // Verify commit was made
      const logRes = await execa('git', ['log', '-1', '--pretty=%s'], {
        cwd: shadowPath,
      });
      expect(logRes.stdout).toContain('[Aura] Tool execution: write_file');
    });

    it('synchronizes deleted files in shadow backup', async () => {
      // Setup parent git repo in projectPath
      await execa('git', ['init'], { cwd: projectPath });
      await execa('git', ['config', 'user.name', 'Test User'], {
        cwd: projectPath,
      });
      await execa('git', ['config', 'user.email', 'test@user.com'], {
        cwd: projectPath,
      });

      // 1. Create a dummy file
      const testFile = path.join(projectPath, 'test-delete.txt');
      fs.writeFileSync(testFile, 'Hello file to delete');

      // 2. Run recordChanges to sync it to the shadow backup (as an untracked file)
      const backup = new ShadowBackup(projectPath);
      await backup.recordChanges('write_file', {
        file_path: 'test-delete.txt',
      });

      // Verify it exists in shadow directory
      const shadowPath = path.join(projectPath, '.aura-workspace', 'shadow');
      expect(fs.existsSync(path.join(shadowPath, 'test-delete.txt'))).toBe(
        true,
      );

      // 3. Commit it in the workspace so it is tracked and can be officially deleted
      await execa('git', ['add', 'test-delete.txt'], { cwd: projectPath });
      await execa('git', ['commit', '-m', 'Commit test file'], {
        cwd: projectPath,
      });

      // 4. Now, delete the file in workspace
      fs.unlinkSync(testFile);

      // 5. Run recordChanges to sync the deletion
      await backup.recordChanges('delete_file', {
        file_path: 'test-delete.txt',
      });

      // Verify the file is removed from shadow backup
      expect(fs.existsSync(path.join(shadowPath, 'test-delete.txt'))).toBe(
        false,
      );
    });

    it('synchronizes renamed files in shadow backup', async () => {
      // Setup parent git repo in projectPath
      await execa('git', ['init'], { cwd: projectPath });
      await execa('git', ['config', 'user.name', 'Test User'], {
        cwd: projectPath,
      });
      await execa('git', ['config', 'user.email', 'test@user.com'], {
        cwd: projectPath,
      });

      // 1. Create a dummy file
      const oldPath = path.join(projectPath, 'old-name.txt');
      fs.writeFileSync(oldPath, 'Content of renamed file');

      // 2. Sync creation to shadow backup
      const backup = new ShadowBackup(projectPath);
      await backup.recordChanges('write_file', { file_path: 'old-name.txt' });

      // Verify it exists in shadow directory
      const shadowPath = path.join(projectPath, '.aura-workspace', 'shadow');
      expect(fs.existsSync(path.join(shadowPath, 'old-name.txt'))).toBe(true);

      // 3. Track and commit it in the workspace git repo so git can track renames
      await execa('git', ['add', 'old-name.txt'], { cwd: projectPath });
      await execa('git', ['commit', '-m', 'Commit old file'], {
        cwd: projectPath,
      });

      // 4. Perform rename using git mv
      await execa('git', ['mv', 'old-name.txt', 'new-name.txt'], {
        cwd: projectPath,
      });

      // 5. Run recordChanges to sync the rename
      await backup.recordChanges('rename_file', {
        file_path: 'new-name.txt',
      });

      // Verify the old file is removed and new file exists in shadow backup
      expect(fs.existsSync(path.join(shadowPath, 'old-name.txt'))).toBe(false);
      expect(fs.existsSync(path.join(shadowPath, 'new-name.txt'))).toBe(true);
      expect(
        fs.readFileSync(path.join(shadowPath, 'new-name.txt'), 'utf-8'),
      ).toBe('Content of renamed file');
    });
  });

  // --- 2. Sandbox ---
  describe('Sandbox', () => {
    it('executes tools via local sandbox wrapper when enabled', async () => {
      const configPath = path.join(
        projectPath,
        '.aura-workspace',
        'config',
        'config.yml',
      );
      const config = {
        security: {
          sandbox: {
            enabled: true,
            provider: 'local',
          },
        },
      };
      fs.writeFileSync(configPath, yaml.stringify(config));

      // Create sandbox wrapper
      const binDir = path.join(projectPath, '.aura-workspace', 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      const wrapperPath = path.join(binDir, 'sandbox-wrapper');
      fs.writeFileSync(
        wrapperPath,
        `#!/bin/bash
echo "===SANDBOXED==="
exec "$@"
`,
      );
      fs.chmodSync(wrapperPath, 0o755);

      // Create dummy tool
      const toolDir = path.join(
        projectPath,
        '.aura-workspace',
        'tools',
        'hello',
      );
      fs.mkdirSync(toolDir, { recursive: true });
      fs.writeFileSync(
        path.join(toolDir, 'manifest.json'),
        JSON.stringify({
          name: 'hello',
          runtime: 'python',
          entry: 'logic.py',
        }),
      );
      fs.writeFileSync(
        path.join(toolDir, 'logic.py'),
        `import json
print(json.dumps({"status": "ok", "message": "hello from tool"}))`,
      );

      const engine = new ExecutionEngine(projectPath);
      const res = await engine.execute('hello', {});
      expect(res.output).toBeDefined();
      expect(res.output).toContain('===SANDBOXED===');
      expect(res.output).toContain('hello from tool');
    });
  });

  // --- 3. GlobalEnv ---
  describe('GlobalEnv', () => {
    it('respects AURA_GLOBAL_ENV environment variable path overrides', () => {
      const origGlobalEnv = process.env.AURA_GLOBAL_ENV;
      const origHome = process.env.HOME;
      const origAuraHome = process.env.AURA_HOME;

      const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-home-'));
      const spy = vi.spyOn(os, 'homedir').mockReturnValue(tempHome);
      process.env.AURA_GLOBAL_ENV = 'true';
      process.env.HOME = tempHome;
      process.env.AURA_HOME = path.join(tempHome, '.aura-framework');

      try {
        const envPath = PathResolver.environmentPath('/some/random/workspace');
        const expected = path.resolve(tempHome, '.aura-framework', 'global');
        expect(envPath).toBe(expected);
      } finally {
        spy.mockRestore();
        if (origGlobalEnv === undefined) {
          delete process.env.AURA_GLOBAL_ENV;
        } else {
          process.env.AURA_GLOBAL_ENV = origGlobalEnv;
        }
        if (origHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = origHome;
        }
        if (origAuraHome === undefined) {
          delete process.env.AURA_HOME;
        } else {
          process.env.AURA_HOME = origAuraHome;
        }
        try {
          fs.rmSync(tempHome, { recursive: true, force: true });
        } catch (_e) {}
      }
    });
  });

  // --- 4. NarrativeMetabolism ---
  describe('NarrativeMetabolism', () => {
    it('synthesizes empty events and handles errors gracefully', async () => {
      const service = new NarrativeService(projectPath);
      const resEmpty = await service.synthesize([]);
      expect(resEmpty).toBe('No events to summarize.');

      // Mock LLM client error
      vi.spyOn(LLMClient.prototype, 'complete').mockRejectedValue(
        new Error('LLM Error Simulation'),
      );
      const serviceWithError = new NarrativeService(projectPath);
      const events = [
        {
          id: 1,
          timestamp: Date.now(),
          payload: { output: 'test' },
          tool: 'echo',
          phase: 'execution',
        },
      ];
      // Synthesize triggers LLM complete call. If it throws, verify fallback is returned.
      // Wait, let's verify narrative synthesis error handling.
      const res = await serviceWithError.synthesize(events);
      expect(res).toContain('Metabolism synthesis failed');
    });
  });

  // --- 5. SkillsCommand ---
  describe('SkillsCommand', () => {
    it('lists available custom skills through CLI', async () => {
      const skillsDir = path.join(projectPath, 'skills', 'test-skill');
      fs.mkdirSync(skillsDir, { recursive: true });

      const skillContent = `---
name: test-skill
description: This is a verified test skill.
---
# Test Skill Guide
Perform task under test conditions.`;
      fs.writeFileSync(path.join(skillsDir, 'SKILL.md'), skillContent);

      const res = await execa('npx', [
        'tsx',
        auraBinPath,
        'skill',
        'list',
        projectPath,
      ]);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('Available Agent Skills');
      expect(res.stdout).toContain('* test-skill');
      expect(res.stdout).toContain('This is a verified test skill.');
    });
  });

  // --- 6. SecureToolIpc ---
  describe('SecureToolIpc', () => {
    it('blocks symlink traversal outside workspace', async () => {
      const outsideFile = path.join(
        os.tmpdir(),
        `aura-outside-${Date.now()}.txt`,
      );
      fs.writeFileSync(outsideFile, 'Secret outside information');

      const symlinkPath = path.join(projectPath, 'bad_link.txt');
      fs.symlinkSync(outsideFile, symlinkPath);

      try {
        const engine = new ExecutionEngine(projectPath);

        // Try reading bad_link.txt via read_file tool
        const resRead = await engine.execute('read_file', {
          file_path: 'bad_link.txt',
        });
        expect(resRead.status).toBe('failed');
        expect(resRead.error).toContain('Security Error');

        // Try writing bad_link.txt via write_file tool
        const resWrite = await engine.execute('write_file', {
          file_path: 'bad_link.txt',
          content: 'hack',
        });
        expect(resWrite.status).toBe('failed');
        expect(resWrite.error).toContain('Security Error');

        // Ensure outside file was not modified
        expect(fs.readFileSync(outsideFile, 'utf-8')).toBe(
          'Secret outside information',
        );
      } finally {
        try {
          fs.unlinkSync(outsideFile);
        } catch (_e) {}
      }
    });

    it('handles read_file line range truncations and single line limits', async () => {
      const engine = new ExecutionEngine(projectPath);

      // Create a file with 1200 lines
      const lines =
        Array.from({ length: 1200 }, (_, i) => `Line ${i + 1}`).join('\n') +
        '\n';
      fs.writeFileSync(path.join(projectPath, 'large_lines.txt'), lines);

      // 1. Default read (truncates at 1000 lines)
      const resDefault = await engine.execute('read_file', {
        file_path: 'large_lines.txt',
      });
      expect(resDefault.status).toBe('ok');
      expect(resDefault.is_truncated).toBe(true);
      expect(resDefault.total_lines).toBe(1200);
      expect(resDefault.content).toContain('Line 1000');
      expect(resDefault.content).not.toContain('Line 1001');

      // 2. Specific range read (1005 to 1010)
      const resRange = await engine.execute('read_file', {
        file_path: 'large_lines.txt',
        start_line: 1005,
        end_line: 1010,
      });
      expect(resRange.status).toBe('ok');
      expect(resRange.content).toBe(
        Array.from({ length: 6 }, (_, i) => `Line ${1005 + i}`).join('\n') +
          '\n',
      );

      // 3. Single line truncation (>10000 characters)
      const longLine = `${'B'.repeat(15000)}\n`;
      fs.writeFileSync(path.join(projectPath, 'long_line.txt'), longLine);

      const resLine = await engine.execute('read_file', {
        file_path: 'long_line.txt',
      });
      expect(resLine.status).toBe('ok');
      expect(resLine.content?.length).toBeLessThan(11000);
      expect(resLine.content).toContain(
        'Line truncated: showing first 10000 chars',
      );
    });
  });
});

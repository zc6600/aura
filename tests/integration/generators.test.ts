import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Tools } from '../../src/cli/commands/tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const auraBinPath = path.resolve(__dirname, '../../src/bin/aura.ts');

describe('Generators Integration', { timeout: 30000 }, () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'aura-generators-integration-'),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch (_e) {}
  });

  // 1. Project Scaffolding
  it('test_scaffold_created', async () => {
    const appPath = path.join(testDir, 'tmp_app_scaffold');
    const res = await execa('npx', ['tsx', auraBinPath, 'new', appPath]);
    expect(res.exitCode).toBe(0);

    const hidden = path.join(appPath, '.aura');
    expect(fs.existsSync(path.join(hidden, 'config', 'config.yml'))).toBe(true);

    const requiredFiles = ['logic.py', 'manifest.json', 'logic.py.hint'];
    for (const f of requiredFiles) {
      expect(fs.existsSync(path.join(hidden, 'tools', 'read_file', f))).toBe(
        true,
      );
    }
  });

  // 2. Tool Group Generation
  describe('Tool Group Generator', () => {
    it('generates correct structure', () => {
      vi.spyOn(process, 'cwd').mockReturnValue(testDir);

      fs.mkdirSync(path.join(testDir, 'tools'), { recursive: true });
      Tools.generateGroup('browser', ['click', 'screenshot']);

      const browserDir = path.join(testDir, 'tools', 'browser');
      expect(fs.existsSync(browserDir)).toBe(true);
      expect(fs.existsSync(path.join(browserDir, 'group_manifest.json'))).toBe(
        true,
      );

      const groupManifest = JSON.parse(
        fs.readFileSync(path.join(browserDir, 'group_manifest.json'), 'utf-8'),
      );
      expect(groupManifest.group_name).toBe('browser');
      expect(groupManifest.entry_tool).toBe('open');
      expect(groupManifest.subtools).toContain('click');
      expect(groupManifest.subtools).toContain('screenshot');
      expect(groupManifest.subtools).toContain('close');

      expect(fs.existsSync(path.join(browserDir, 'open'))).toBe(true);
      expect(fs.existsSync(path.join(browserDir, 'click'))).toBe(true);
      expect(fs.existsSync(path.join(browserDir, 'close'))).toBe(true);

      const clickManifest = JSON.parse(
        fs.readFileSync(
          path.join(browserDir, 'click', 'manifest.json'),
          'utf-8',
        ),
      );
      expect(clickManifest.name).toBe('browser_click');
      expect(clickManifest.requires_context).toBe('browser_session');
      expect(clickManifest.input_schema.required).toContain('context_id');
    });

    it('entry tool auto loads', () => {
      vi.spyOn(process, 'cwd').mockReturnValue(testDir);

      fs.mkdirSync(path.join(testDir, 'tools'), { recursive: true });
      Tools.generateGroup('search', []);

      const openManifest = JSON.parse(
        fs.readFileSync(
          path.join(testDir, 'tools', 'search', 'open', 'manifest.json'),
          'utf-8',
        ),
      );
      expect(openManifest.auto_load).toBe(true);
      expect(openManifest.creates_context).toBe('search_session');
    });

    it('close tool destroys context', () => {
      vi.spyOn(process, 'cwd').mockReturnValue(testDir);

      fs.mkdirSync(path.join(testDir, 'tools'), { recursive: true });
      Tools.generateGroup('db', []);

      const closeManifest = JSON.parse(
        fs.readFileSync(
          path.join(testDir, 'tools', 'db', 'close', 'manifest.json'),
          'utf-8',
        ),
      );
      expect(closeManifest.destroys_context).toBe(true);
    });
  });

  // 3. Tools Generator
  describe('Tools Generator (Add Tool)', () => {
    it('add tool success', async () => {
      const mockTemplateDir = path.join(testDir, 'templates');
      fs.mkdirSync(path.join(mockTemplateDir, 'tools', 'dummy_tool'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(mockTemplateDir, 'tools', 'dummy_tool', 'manifest.json'),
        JSON.stringify({ name: 'dummy' }),
      );

      process.env.AURA_GLOBAL_REPO_PATH = mockTemplateDir;

      const projectPath = path.join(testDir, 'proj');
      fs.mkdirSync(projectPath, { recursive: true });
      fs.mkdirSync(path.join(projectPath, '.aura'), { recursive: true });

      vi.spyOn(process, 'cwd').mockReturnValue(projectPath);
      const consoleLogSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      await Tools.add('dummy_tool');

      expect(
        fs.existsSync(
          path.join(projectPath, 'tools', 'dummy_tool', 'manifest.json'),
        ),
      ).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Tool 'dummy_tool' installed successfully!"),
      );

      delete process.env.AURA_GLOBAL_REPO_PATH;
    });

    it('add tool failure not found', async () => {
      const mockTemplateDir = path.join(testDir, 'templates');
      fs.mkdirSync(path.join(mockTemplateDir, 'tools'), { recursive: true });
      process.env.AURA_GLOBAL_REPO_PATH = mockTemplateDir;

      const projectPath = path.join(testDir, 'proj');
      fs.mkdirSync(projectPath, { recursive: true });
      fs.mkdirSync(path.join(projectPath, '.aura'), { recursive: true });

      vi.spyOn(process, 'cwd').mockReturnValue(projectPath);
      await expect(Tools.add('non_existent_tool')).rejects.toThrow(
        "Tool 'non_existent_tool' not found",
      );

      delete process.env.AURA_GLOBAL_REPO_PATH;
    });
  });
});

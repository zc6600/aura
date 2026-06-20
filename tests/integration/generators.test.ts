import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Create } from '../../src/cli/commands/create.js';
import { Doctor } from '../../src/cli/commands/doctor.js';
import { PackageCommand } from '../../src/cli/commands/package.js';
import { Tools } from '../../src/cli/commands/tools.js';
import { Workflow } from '../../src/cli/commands/workflow.js';
import { Runner } from '../../src/core/kernel/runner.js';
import { loadWorkflow } from '../../src/core/workflow/manifest.js';
import { getWorkflowStatus } from '../../src/core/workflow/runner.js';
import * as PathResolver from '../../src/utils/pathResolver.js';

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

    const hidden = path.join(appPath, '.aura-workspace');
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
      fs.mkdirSync(path.join(projectPath, '.aura-workspace'), {
        recursive: true,
      });

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
      fs.mkdirSync(path.join(projectPath, '.aura-workspace'), {
        recursive: true,
      });

      vi.spyOn(process, 'cwd').mockReturnValue(projectPath);
      await expect(Tools.add('non_existent_tool')).rejects.toThrow(
        "Tool 'non_existent_tool' not found",
      );

      delete process.env.AURA_GLOBAL_REPO_PATH;
    });
  });

  describe('Create Scaffolds', () => {
    function initWorkspace(root: string) {
      fs.mkdirSync(path.join(root, '.aura-workspace'), { recursive: true });
      fs.mkdirSync(path.join(root, '.aura-workspace', 'config'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(root, '.aura-workspace', 'config', 'config.yml'),
        'model: test\n',
      );
    }

    it('creates a tool scaffold with manifest, logic, and hint', () => {
      initWorkspace(testDir);
      vi.spyOn(process, 'cwd').mockReturnValue(testDir);

      Create.tool('count_lines', {
        autoLoad: true,
        allowPath: './data,./reports',
      });

      const toolDir = path.join(testDir, 'tools', 'count_lines');
      expect(fs.existsSync(path.join(toolDir, 'manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(toolDir, 'logic.py'))).toBe(true);
      expect(fs.existsSync(path.join(toolDir, 'logic.py.hint'))).toBe(true);

      const manifest = JSON.parse(
        fs.readFileSync(path.join(toolDir, 'manifest.json'), 'utf-8'),
      );
      expect(manifest.name).toBe('count_lines');
      expect(manifest.runtime).toBe('python3');
      expect(manifest.auto_load).toBe(true);
      expect(manifest.permissions.allow_paths).toEqual(['./data', './reports']);
      expect(manifest.input_schema.type).toBe('object');
    });

    it('creates skill, garden, persona, anchor, and prompt scaffolds', () => {
      initWorkspace(testDir);
      vi.spyOn(process, 'cwd').mockReturnValue(testDir);

      Create.skill('line-count-review');
      Create.garden('research-flow');
      Create.workflow('research-flow');
      Create.persona('auditor');
      Create.anchor('baseline_done');
      Create.prompt('agents');

      expect(
        fs.readFileSync(
          path.join(testDir, 'skills', 'line-count-review', 'SKILL.md'),
          'utf-8',
        ),
      ).toContain('name: line-count-review');
      expect(
        fs.readFileSync(
          path.join(testDir, 'garden', 'research-flow', 'garden.md'),
          'utf-8',
        ),
      ).toContain('name: research-flow');
      expect(
        fs.readFileSync(path.join(testDir, 'workflow.yml'), 'utf-8'),
      ).toContain('name: research-flow');
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(testDir, 'state', 'personas', 'auditor.json'),
            'utf-8',
          ),
        ).instructions,
      ).toContain('auditor');
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(testDir, 'anchors', 'baseline_done.json'),
            'utf-8',
          ),
        ).id,
      ).toBe('baseline_done');
      expect(
        fs.readFileSync(
          path.join(testDir, 'prompts', 'system', 'AGENTS.md'),
          'utf-8',
        ),
      ).toContain('# OPERATING INSTRUCTIONS');
    });

    it('fails when creating a scaffold over an existing file', () => {
      initWorkspace(testDir);
      vi.spyOn(process, 'cwd').mockReturnValue(testDir);

      Create.persona('reviewer');

      expect(() => Create.persona('reviewer')).toThrow(
        "Persona 'reviewer' already exists",
      );
    });

    it('creates scaffolds through the CLI entrypoint', async () => {
      initWorkspace(testDir);

      const res = await execa(
        'npx',
        ['tsx', auraBinPath, 'create', 'skill', 'cli-skill'],
        { cwd: testDir },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('Created skill scaffold');
      expect(
        fs.existsSync(path.join(testDir, 'skills', 'cli-skill', 'SKILL.md')),
      ).toBe(true);
    });

    it('validates workflow doctor and prints workflow status', () => {
      initWorkspace(testDir);
      vi.spyOn(process, 'cwd').mockReturnValue(testDir);

      fs.mkdirSync(path.join(testDir, 'params'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'params', 'demo.yml'), 'mode: dry\n');

      fs.mkdirSync(path.join(testDir, 'garden', 'demo'), { recursive: true });
      fs.writeFileSync(
        path.join(testDir, 'garden', 'demo', 'garden.md'),
        '---\nname: demo\n---\n# Demo Garden\n',
      );

      fs.mkdirSync(path.join(testDir, 'skills', 'demo'), { recursive: true });
      fs.writeFileSync(
        path.join(testDir, 'skills', 'demo', 'SKILL.md'),
        '---\nname: demo\n---\n# Demo Skill\n',
      );

      fs.mkdirSync(path.join(testDir, 'prompts', 'system'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(testDir, 'prompts', 'system', 'SOUL.md'),
        '# Persona\n',
      );

      fs.mkdirSync(path.join(testDir, 'anchors'), { recursive: true });
      fs.writeFileSync(
        path.join(testDir, 'anchors', '00_ready.json'),
        JSON.stringify({ id: '00_ready', call_when: ['ready'] }),
      );

      fs.mkdirSync(path.join(testDir, 'tools', 'demo_tool'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(testDir, 'tools', 'demo_tool', 'manifest.json'),
        JSON.stringify({
          name: 'demo_tool',
          runtime: 'python3',
          entry: 'logic.py',
          input_schema: { type: 'object', properties: {}, required: [] },
        }),
      );
      fs.writeFileSync(
        path.join(testDir, 'tools', 'demo_tool', 'logic.py'),
        [
          '#!/usr/bin/env python3',
          'import json',
          'print(json.dumps({"status": "ok"}))',
          '',
        ].join('\n'),
      );

      fs.writeFileSync(
        path.join(testDir, 'workflow.yml'),
        [
          'version: 1',
          'name: demo',
          'params:',
          '  path: params/demo.yml',
          'context:',
          '  garden: garden/demo/garden.md',
          '  skill: skills/demo/SKILL.md',
          '  prompts:',
          '    - prompts/system/SOUL.md',
          'tools:',
          '  required:',
          '    - demo_tool',
          'stages:',
          '  - id: ready',
          '    anchor: anchors/00_ready.json',
          'run:',
          '  goal: Run demo.',
          '',
        ].join('\n'),
      );

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      expect(() => Workflow.doctor(undefined, testDir)).not.toThrow();
      expect(() => Workflow.smoke(undefined, testDir)).not.toThrow();
      Workflow.status(undefined, testDir);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Workflow: demo'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('required tool demo_tool'),
      );
    });

    it('initializes, explains, and graphs a workflow contract', () => {
      initWorkspace(testDir);
      vi.spyOn(process, 'cwd').mockReturnValue(testDir);

      Workflow.init('bench-flow', {
        withParams: true,
        withPrompts: true,
        withAnchors: true,
      });

      expect(fs.existsSync(path.join(testDir, 'workflow.yml'))).toBe(true);
      expect(
        fs.existsSync(path.join(testDir, 'params', 'bench-flow.yml')),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(testDir, 'prompts', 'system', 'SOUL.md')),
      ).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'anchors', '00_ready.json'))).toBe(
        true,
      );

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      Workflow.explain(undefined, testDir);
      Workflow.graph(undefined, testDir);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Workflow: bench-flow'),
      );
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ready'));
    });

    it('validates local tool manifests with tools doctor', () => {
      initWorkspace(testDir);
      fs.mkdirSync(path.join(testDir, 'tools', 'demo_tool'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(testDir, 'tools', 'demo_tool', 'manifest.json'),
        JSON.stringify({
          name: 'demo_tool',
          runtime: 'python3',
          entry: 'logic.py',
          input_schema: { type: 'object', properties: {}, required: [] },
        }),
      );
      fs.writeFileSync(
        path.join(testDir, 'tools', 'demo_tool', 'logic.py'),
        'print("{}")\n',
      );

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      expect(() => Tools.doctor(testDir)).not.toThrow();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('All tools passed doctor checks.'),
      );
    });

    it('installs a use-case package into a workspace', () => {
      initWorkspace(testDir);
      const pkg = path.join(testDir, 'pkg');
      fs.mkdirSync(path.join(pkg, 'template', 'src'), { recursive: true });
      fs.mkdirSync(path.join(pkg, 'tools', 'pkg_tool'), { recursive: true });
      fs.writeFileSync(
        path.join(pkg, 'template', 'workflow.yml'),
        'version: 1\nname: pkg\nrun:\n  goal: Run package.\n',
      );
      fs.writeFileSync(
        path.join(pkg, 'template', 'src', 'main.py'),
        'print("ok")\n',
      );
      fs.writeFileSync(
        path.join(pkg, 'tools', 'pkg_tool', 'manifest.json'),
        JSON.stringify({ name: 'pkg_tool', runtime: 'python3', entry: 'logic.py' }),
      );
      fs.writeFileSync(
        path.join(pkg, 'tools', 'pkg_tool', 'logic.py'),
        'print("{}")\n',
      );

      expect(() => PackageCommand.install(pkg, { to: testDir })).not.toThrow();
      expect(fs.existsSync(path.join(testDir, 'workflow.yml'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'src', 'main.py'))).toBe(true);
      expect(
        fs.existsSync(path.join(testDir, 'tools', 'pkg_tool', 'manifest.json')),
      ).toBe(true);
    });

    it('checks workspace health without requiring a workflow', () => {
      initWorkspace(testDir);
      vi.spyOn(process, 'cwd').mockReturnValue(testDir);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      expect(() => Doctor.checkWorkspace()).not.toThrow();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not declared'));
    });

    it('fails workflow doctor when a ralph verify command references a missing file', () => {
      initWorkspace(testDir);

      fs.mkdirSync(path.join(testDir, 'anchors'), { recursive: true });
      fs.writeFileSync(
        path.join(testDir, 'anchors', 'verify.json'),
        JSON.stringify({ id: 'verify', call_when: ['verify'] }),
      );
      fs.writeFileSync(
        path.join(testDir, 'workflow.yml'),
        [
          'version: 1',
          'name: ralph-missing',
          'stages:',
          '  - id: verify',
          '    anchor: anchors/verify.json',
          '    ralph:',
          '      verify_cmd: "python scripts/missing_verify.py"',
          'run:',
          '  goal: Verify candidate.',
          '',
        ].join('\n'),
      );

      expect(() => Workflow.doctor(undefined, testDir)).toThrow(
        /workflow check\(s\) failed/,
      );
    });

    it('executes tools from the workspace root through kernel run_call', async () => {
      initWorkspace(testDir);
      fs.mkdirSync(path.join(testDir, 'tools', 'root_tool'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(testDir, 'tools', 'root_tool', 'manifest.json'),
        JSON.stringify({
          name: 'root_tool',
          runtime: 'python3',
          entry: 'logic.py',
          input_schema: { type: 'object', properties: {}, required: [] },
        }),
      );
      fs.writeFileSync(
        path.join(testDir, 'tools', 'root_tool', 'logic.py'),
        [
          '#!/usr/bin/env python3',
          'import json',
          'print(json.dumps({"status": "ok", "source": "workspace-root"}))',
          '',
        ].join('\n'),
      );

      const runner = new Runner(testDir);
      const result = await runner.runCall({ tool: 'root_tool', args: {} });
      expect(result.status).toBe('ok');
      expect(result.source).toBe('workspace-root');
    });

    it('marks a stage completed using anchor file id instead of basename', () => {
      initWorkspace(testDir);

      fs.mkdirSync(path.join(testDir, 'params'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'params', 'demo.yml'), 'mode: dry\n');

      fs.mkdirSync(path.join(testDir, 'anchors'), { recursive: true });
      fs.writeFileSync(
        path.join(testDir, 'anchors', '00_ready.json'),
        JSON.stringify({ id: 'ready_anchor', call_when: ['ready'] }),
      );

      fs.mkdirSync(path.join(testDir, 'tools', 'demo_tool'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(testDir, 'tools', 'demo_tool', 'manifest.json'),
        JSON.stringify({
          name: 'demo_tool',
          runtime: 'python3',
          entry: 'logic.py',
          input_schema: { type: 'object', properties: {}, required: [] },
        }),
      );

      fs.writeFileSync(
        path.join(testDir, 'workflow.yml'),
        [
          'version: 1',
          'name: demo',
          'params:',
          '  path: params/demo.yml',
          'tools:',
          '  required:',
          '    - demo_tool',
          'stages:',
          '  - id: ready',
          '    title: Workspace ready',
          '    anchor: anchors/00_ready.json',
          'run:',
          '  goal: Run demo.',
          '',
        ].join('\n'),
      );

      const dbPath = PathResolver.sessionDbPath(testDir);
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      try {
        db.exec(
          'CREATE TABLE events (id INTEGER PRIMARY KEY, timestamp INTEGER, phase TEXT, tool TEXT, payload TEXT)',
        );
        db.prepare(
          'INSERT INTO events (timestamp, phase, tool, payload) VALUES (?, ?, ?, ?)',
        ).run(
          Math.floor(Date.now() / 1000),
          'tool',
          'anchor_submit',
          JSON.stringify({ anchor_id: 'ready_anchor', summary: 'done' }),
        );
      } finally {
        db.close();
      }

      const status = getWorkflowStatus(loadWorkflow(testDir));
      expect(status.stages).toHaveLength(1);
      expect(status.stages[0].completed).toBe(true);
    });
  });
});

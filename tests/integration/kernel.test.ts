import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import yaml from 'yaml';

import { ExecutionEngine } from '../../src/core/kernel/executionEngine.js';
import { Runner } from '../../src/core/kernel/runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const auraBinPath = path.resolve(__dirname, '../../src/bin/aura.ts');

interface ManifestContent {
  name?: string;
  runtime?: string;
  entry?: string;
  timeout?: number;
}

interface Config {
  tool_protocol?: {
    default_timeout_seconds?: number;
    max_timeout_seconds?: number;
    agent_can_modify_timeout?: boolean;
    call_summary?: {
      max_chars?: number;
    };
  };
}

describe('Kernel Integration', { timeout: 90000 }, () => {
  let projectPath: string;
  let envPath: string;
  let toolsPath: string;
  let configPath: string;
  let runner: Runner;

  beforeEach(async () => {
    projectPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'aura-kernel-integration-'),
    );

    // Initialize workspace scaffolding
    const res = await execa('npx', ['tsx', auraBinPath, 'new', projectPath]);
    expect(res.exitCode).toBe(0);

    envPath = path.join(projectPath, '.aura-workspace');
    toolsPath = path.join(envPath, 'tools');
    configPath = path.join(envPath, 'config', 'config.yml');

    runner = new Runner(projectPath);
  });

  afterEach(() => {
    try {
      if (runner?.memory?.store) {
        runner.memory.store.close();
      }
    } catch (_e) {}
    try {
      if (fs.existsSync(projectPath)) {
        fs.rmSync(projectPath, { recursive: true, force: true });
      }
    } catch (_e) {}
  });

  function writeTool(
    toolName: string,
    logicContent: string,
    manifestContent: ManifestContent = {},
  ) {
    const dir = path.join(toolsPath, toolName);
    fs.mkdirSync(dir, { recursive: true });

    const manifest = {
      name: toolName,
      runtime: 'python',
      entry: 'logic.py',
      ...manifestContent,
    };
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
    fs.writeFileSync(path.join(dir, 'logic.py'), logicContent);
  }

  function writeConfig(cfgObj: Config) {
    fs.writeFileSync(configPath, yaml.stringify(cfgObj));
    if (runner) {
      runner.clearConfigCache();
    }
  }

  // --- 1. Execution Engine Output Parsing ---
  describe('Execution Engine Parsing', () => {
    it('handles success plain text output', async () => {
      writeTool('plain_output', `import sys\nprint("hello")`);
      const engine = new ExecutionEngine(projectPath);
      const res = await engine.execute('plain_output', {});
      expect(res.status).toBe('ok');
      expect(res.output).toBe('hello');
    });

    it('handles success JSON output', async () => {
      writeTool(
        'json_output',
        `import json\nprint(json.dumps({"status": "ok", "content": "world"}))`,
      );
      const engine = new ExecutionEngine(projectPath);
      const res = await engine.execute('json_output', {});
      expect(res.status).toBe('ok');
      expect(res.content).toBe('world');
    });

    it('handles failure nonzero exit codes', async () => {
      writeTool(
        'bad_output',
        `import sys\nsys.stderr.write("boom")\nsys.exit(1)`,
      );
      const engine = new ExecutionEngine(projectPath);
      const res = await engine.execute('bad_output', {});
      expect(res.status).toBe('failed');
      expect(res.error).toContain('boom');
    });
  });

  // --- 2. Timeout Configurations & Precedences ---
  describe('Timeout Configurations', () => {
    it('respects default timeout from config', async () => {
      writeConfig({
        tool_protocol: {
          default_timeout_seconds: 1,
          max_timeout_seconds: 10,
          agent_can_modify_timeout: true,
        },
      });
      writeTool('t1', `import time\ntime.sleep(5)\nprint("finished")`);

      const engine = new ExecutionEngine(projectPath);
      const start = Date.now();
      const res = await engine.execute('t1', {});
      const elapsed = (Date.now() - start) / 1000;

      expect(elapsed).toBeLessThan(4);
      expect(res.status).toBe('failed');
      expect(res.error).toContain('timed out');
    });

    it('respects manifest timeout override', async () => {
      writeConfig({
        tool_protocol: {
          default_timeout_seconds: 5,
          max_timeout_seconds: 10,
          agent_can_modify_timeout: true,
        },
      });
      writeTool('t2', `import time\ntime.sleep(5)\nprint("finished")`, {
        timeout: 1,
      });

      const engine = new ExecutionEngine(projectPath);
      const start = Date.now();
      const res = await engine.execute('t2', {});
      const elapsed = (Date.now() - start) / 1000;

      expect(elapsed).toBeLessThan(4);
      expect(res.status).toBe('failed');
      expect(res.error).toContain('timed out');
    });

    it('respects agent timeout override', async () => {
      writeConfig({
        tool_protocol: {
          default_timeout_seconds: 5,
          max_timeout_seconds: 10,
          agent_can_modify_timeout: true,
        },
      });
      writeTool('t3', `import time\ntime.sleep(5)\nprint("finished")`);

      const engine = new ExecutionEngine(projectPath);
      const start = Date.now();
      const res = await engine.execute('t3', { timeout_seconds: 1 });
      const elapsed = (Date.now() - start) / 1000;

      expect(elapsed).toBeLessThan(4);
      expect(res.status).toBe('failed');
      expect(res.error).toContain('timed out');
    });

    it('denies agent override by config config', async () => {
      writeConfig({
        tool_protocol: {
          default_timeout_seconds: 2,
          max_timeout_seconds: 10,
          agent_can_modify_timeout: false,
        },
      });
      writeTool('t4', `print("finished")`);

      const engine = new ExecutionEngine(projectPath);
      const res = await engine.execute('t4', { timeout_seconds: 20 });
      expect(res.status).toBe('ok');
    });

    it('clamps timeout to max_timeout_seconds', async () => {
      writeConfig({
        tool_protocol: {
          default_timeout_seconds: 5,
          max_timeout_seconds: 1,
          agent_can_modify_timeout: true,
        },
      });
      writeTool('t5', `import time\ntime.sleep(5)\nprint("finished")`);

      const engine = new ExecutionEngine(projectPath);
      const start = Date.now();
      const res = await engine.execute('t5', { timeout_seconds: 10 });
      const elapsed = (Date.now() - start) / 1000;

      expect(elapsed).toBeLessThan(4);
      expect(res.status).toBe('failed');
      expect(res.error).toContain('timed out');
    });
  });

  // --- 3. Call Summary Truncation ---
  describe('Call Summary Truncation', () => {
    it('truncates and persists long summaries based on configuration limit', async () => {
      writeConfig({
        tool_protocol: {
          call_summary: {
            max_chars: 20,
          },
        },
      });

      writeTool('dummy_tool', `print('ok')`);

      const longSummary = '这是一个超过二十字的摘要文本，用于测试截断。';
      const res = await runner.runCall({
        tool: 'dummy_tool',
        args: {},
        summary: longSummary,
      });
      expect(res.status).toBe('ok');

      const summaries = runner.memory.store.fetchSummaries();
      const latestSummaryRecord = summaries[summaries.length - 1];
      const latestSummary = latestSummaryRecord
        ? latestSummaryRecord.content
        : null;

      expect(latestSummary).not.toBeNull();
      if (latestSummary) {
        expect(latestSummary.length).toBeLessThanOrEqual(20);
        expect(longSummary.startsWith(latestSummary)).toBe(true);
      }

      const ctx = (await runner.observe()).toMarkdown();
      expect(ctx).toContain('History');
    });
  });
});

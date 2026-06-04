import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execa } from 'execa';
import { fileURLToPath } from 'node:url';

import { Runner } from '../../src/core/kernel/runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const auraBinPath = path.resolve(__dirname, '../../src/bin/aura.ts');

describe('Hierarchical Lifecycle Integration', { timeout: 30000 }, () => {
  let projectPath: string;
  let runner: Runner;

  beforeEach(async () => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-lifecycle-integration-'));

    // Initialize workspace via CLI
    const res = await execa('npx', ['tsx', auraBinPath, 'new', projectPath]);
    expect(res.exitCode).toBe(0);

    runner = new Runner(projectPath);

    // Setup browser tool group
    const browserDir = path.join(projectPath, '.aura', 'tools', 'browser');
    fs.mkdirSync(browserDir, { recursive: true });

    // 1. group_manifest.json
    fs.writeFileSync(
      path.join(browserDir, 'group_manifest.json'),
      JSON.stringify({
        group_name: 'browser',
        entry_tool: 'open',
        context: {
          name: 'browser_session',
          multi_instance: true,
          lifecycle: {
            created_by: 'open',
            destroyed_by: ['close'],
            ttl: { seconds: 10 },
          },
        },
        subtools: ['click', 'close'],
      }, null, 2)
    );

    // 2. browser_open
    const openDir = path.join(browserDir, 'open');
    fs.mkdirSync(openDir, { recursive: true });
    fs.writeFileSync(
      path.join(openDir, 'manifest.json'),
      JSON.stringify({
        name: 'browser_open',
        creates_context: 'browser_session',
        runtime: 'python',
        entry: 'logic.py',
      }, null, 2)
    );
    fs.writeFileSync(
      path.join(openDir, 'logic.py'),
      `import json
print(json.dumps({"success": True, "context_id": "session_123", "data": {"url": "http://example.com"}}))`
    );

    // 3. browser_click
    const clickDir = path.join(browserDir, 'click');
    fs.mkdirSync(clickDir, { recursive: true });
    fs.writeFileSync(
      path.join(clickDir, 'manifest.json'),
      JSON.stringify({
        name: 'browser_click',
        requires_context: 'browser_session',
        runtime: 'python',
        entry: 'logic.py',
      }, null, 2)
    );
    fs.writeFileSync(
      path.join(clickDir, 'logic.py'),
      `import sys, json
args = json.loads(sys.stdin.read())
if args.get("context_id") == "session_123":
    print(json.dumps({"success": True, "message": "Clicked with session_123"}))
else:
    print(json.dumps({"success": False, "error": "Wrong context_id"}))`
    );

    // 4. browser_close
    const closeDir = path.join(browserDir, 'close');
    fs.mkdirSync(closeDir, { recursive: true });
    fs.writeFileSync(
      path.join(closeDir, 'manifest.json'),
      JSON.stringify({
        name: 'browser_close',
        requires_context: 'browser_session',
        destroys_context: true,
        runtime: 'python',
        entry: 'logic.py',
      }, null, 2)
    );
    fs.writeFileSync(
      path.join(closeDir, 'logic.py'),
      `import sys, json
args = json.loads(sys.stdin.read())
print(json.dumps({"success": True, "context_destroyed": args.get("context_id")}))`
    );

    // Set configuration
    const configPath = path.join(projectPath, '.aura', 'config', 'config.yml');
    fs.writeFileSync(configPath, 'tool_protocol: { core_tools: [] }');
  });

  afterEach(() => {
    try {
      if (runner && runner.memory && runner.memory.store) {
        runner.memory.store.close();
      }
    } catch (e) {}
    try {
      if (fs.existsSync(projectPath)) {
        fs.rmSync(projectPath, { recursive: true, force: true });
      }
    } catch (e) {}
  });

  it('test_lifecycle_flow', async () => {
    // Step A: Initially, browser_click is in context but with no active instances
    let ctx = (await runner.observe()).toMarkdown();
    expect(ctx).toContain('## browser_click');
    expect(ctx).toContain('No active instances');
    expect(ctx).not.toContain('Active instances: session_123');

    // Step B: Open browser
    const resOpen = await runner.runCall({
      tool: 'browser_open',
      args: {},
      summary: 'Open browser',
    });
    expect(resOpen.success).toBe(true);
    expect(resOpen.context_id).toBe('session_123');

    // Step C: Verify context was stored in tool_contexts.json
    const stateFile = path.join(projectPath, '.aura', 'state', 'tool_contexts.json');
    expect(fs.existsSync(stateFile)).toBe(true);
    let stateData = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(stateData.contexts.session_123).toBeDefined();
    expect(stateData.contexts.session_123.type).toBe('browser_session');
    const initialLastUsed = stateData.contexts.session_123.last_used_at;

    // Step D: After opening, browser_click has active instances
    ctx = (await runner.observe()).toMarkdown();
    expect(ctx).toContain('## browser_click');
    expect(ctx).toContain('Active instances: session_123');

    // Sleep to ensure timestamp changes for sliding TTL update
    await new Promise((r) => setTimeout(r, 1050));

    // Step E: Use click (updates activity / last_used_at)
    const resClick = await runner.runCall({
      tool: 'browser_click',
      args: { context_id: 'session_123' },
      summary: 'Click',
    });
    expect(resClick.success).toBe(true);
    expect(resClick.message).toBe('Clicked with session_123');

    // Verify sliding TTL update
    stateData = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    const updatedLastUsed = stateData.contexts.session_123.last_used_at;
    expect(new Date(updatedLastUsed).getTime()).toBeGreaterThan(new Date(initialLastUsed).getTime());

    // Step F: Close browser
    const resClose = await runner.runCall({
      tool: 'browser_close',
      args: { context_id: 'session_123' },
      summary: 'Close browser',
    });
    expect(resClose.success).toBe(true);
    expect(resClose.context_destroyed).toBe('session_123');

    // Step G: After closing, browser_click reverts to no active instances
    ctx = (await runner.observe()).toMarkdown();
    expect(ctx).toContain('## browser_click');
    expect(ctx).toContain('No active instances');
    expect(ctx).not.toContain('Active instances: session_123');

    // Verify removed from tool_contexts.json
    stateData = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(stateData.contexts.session_123).toBeUndefined();
  });
});

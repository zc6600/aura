import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { ToolProvider } from '../../src/core/context/providers/toolProvider.js';
import { Runner } from '../../src/core/kernel/runner.js';

describe('MCP Integration', { timeout: 30000 }, () => {
  let projectPath: string;
  let runner: Runner;

  beforeEach(async () => {
    const tmpRoot =
      process.platform !== 'win32' && fs.existsSync('/tmp')
        ? fs.realpathSync('/tmp')
        : os.tmpdir();
    projectPath = fs.mkdtempSync(path.join(tmpRoot, 'aura-mcp-integration-'));
    fs.mkdirSync(path.join(projectPath, '.aura-workspace'), {
      recursive: true,
    });

    runner = new Runner(projectPath);

    // Create a mock stdio MCP server script
    const serverScriptPath = path.join(projectPath, 'mcp_mock_server.js');
    fs.writeFileSync(
      serverScriptPath,
      `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  const id = msg.id;
  const method = msg.method;
  if (method === 'initialize') {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, result: { capabilities: { tools: { listChanged: false } } } }));
  } else if (method === 'tools/list') {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, result: { tools: [ { name: 'ping', description: 'Ping tool', inputSchema: { type: 'object', properties: {}, required: [] } } ] } }));
  } else if (method === 'tools/call') {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [ { type: 'text', text: 'pong' } ], isError: false } }));
  }
});
      `.trim(),
    );

    // Setup configuration
    const envPath = runner.envPath;
    const mcpToolsDir = path.join(envPath, 'tools', 'mcp');
    fs.mkdirSync(mcpToolsDir, { recursive: true });

    const mcpConfig = {
      servers: [
        {
          name: 'test',
          transport: 'stdio',
          command: 'node',
          args: [serverScriptPath],
          env: {},
          timeout: 5,
          auto_load: true,
        },
      ],
    };
    fs.writeFileSync(
      path.join(mcpToolsDir, 'config.yml'),
      yaml.stringify(mcpConfig),
    );
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

  it('test_tool_provider_includes_mcp_tools_and_calls_successfully', async () => {
    // 1. Check ToolProvider lists the MCP tool
    const provider = new ToolProvider(projectPath, {
      state: runner.memory.store,
    });
    const text = provider.provide();

    expect(text).toContain('mcp.test.ping');
    expect(text).toContain('Description: Ping tool');

    // 2. Call tool via Runner execution engine
    const res = await runner.runCall({
      tool: 'mcp.test.ping',
      args: {},
      summary: 'Call ping tool',
    });

    expect(res.status).toBe('ok');
    expect(res.content).toBe('pong');
  });
});

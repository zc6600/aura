import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execa } from 'execa';
import { fileURLToPath } from 'node:url';

import { LSPClient } from '../../src/core/ext/lsp/client.js';
import { LSPManager } from '../../src/core/ext/lsp/manager.js';
import { LSPProvider } from '../../src/core/context/providers/lspProvider.js';
import { Runner } from '../../src/core/kernel/runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const auraBinPath = path.resolve(__dirname, '../../src/bin/aura.ts');

describe('LSP Integration', { timeout: 30000 }, () => {
  let projectPath: string;
  let runner: Runner;

  beforeEach(async () => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-lsp-integration-'));

    // Scaffolding
    const res = await execa('npx', ['tsx', auraBinPath, 'new', projectPath]);
    expect(res.exitCode).toBe(0);

    runner = new Runner(projectPath);
  }, 30000); // 30s hook timeout

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

  // 1. LSPClient JSON-RPC stream framing & request/response
  it('test_client_initialize_flow', async () => {
    const serverScript = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf-8');
  const doubleNL = buffer.indexOf('\\r\\n\\r\\n');
  if (doubleNL !== -1) {
    const header = buffer.substring(0, doubleNL);
    const lengthMatch = header.match(/Content-Length:\\s*(\\d+)/i);
    if (lengthMatch) {
      const length = parseInt(lengthMatch[1], 10);
      const totalLen = doubleNL + 4 + length;
      if (buffer.length >= totalLen) {
        const bodyStr = buffer.substring(doubleNL + 4, totalLen);
        buffer = buffer.substring(totalLen);
        try {
          const msg = JSON.parse(bodyStr);
          if (msg.method === 'initialize') {
            const resp = {
              jsonrpc: '2.0',
              id: msg.id,
              result: { capabilities: { textDocumentSync: 1 } },
            };
            const respBody = JSON.stringify(resp);
            const headerOut = \`Content-Length: \${Buffer.byteLength(respBody, 'utf-8')}\\r\\n\\r\\n\`;
            process.stdout.write(headerOut + respBody);
          }
        } catch (e) {}
      }
    }
  }
});
    `;
    const serverScriptPath = path.join(projectPath, 'lsp_mock_server.js');
    fs.writeFileSync(serverScriptPath, serverScript.trim());

    const client = new LSPClient(process.execPath, [serverScriptPath]);
    const initPromise = client.initializeServer(projectPath);
    const res = await initPromise;

    expect(res).toBeDefined();
    expect(res.result).toBeDefined();
    expect(client.server_capabilities.textDocumentSync).toBe(1);

    client.stop();
  });

  // 2. LSPManager diagnostics updates
  it('test_lsp_manager_diagnostics', () => {
    const manager = new LSPManager(projectPath);
    const testFile = 'src/test.rb';

    // Mock updateDiagnostics
    const params = {
      uri: `file://${path.resolve(projectPath, testFile).replace(/\\/g, '/')}`,
      diagnostics: [
        {
          severity: 1,
          message: 'Syntax error',
          range: { start: { line: 0, character: 0 } },
        },
      ],
    };

    // Call private updateDiagnostics via type casting or bracket notation
    (manager as any).updateDiagnostics(params);

    const diags = manager.getDiagnostics(testFile) as any[];
    expect(diags.length).toBe(1);
    expect(diags[0].message).toBe('Syntax error');
    expect(diags[0].severity).toBe(1);
  });

  // 3. LSPProvider prompt rendering
  it('test_lsp_provider_provides_markdown_diagnostics', () => {
    const manager = new LSPManager(projectPath);
    const provider = new LSPProvider(projectPath, manager);

    // Initial check (no diagnostics)
    expect(provider.provide()).toBe('');

    // Inject diagnostics
    const testFile = 'src/logic.py';
    const params = {
      uri: `file://${path.resolve(projectPath, testFile).replace(/\\/g, '/')}`,
      diagnostics: [
        {
          severity: 1,
          message: 'Unexpected token',
          range: { start: { line: 4, character: 2 } },
        },
      ],
    };
    (manager as any).updateDiagnostics(params);

    const output = provider.provide();
    expect(output).toContain('# CODE HEALTH');
    expect(output).toContain('src/logic.py: 1 errors');
    expect(output).toContain('[L5] Error: Unexpected token');
  });

  // 4. Runner.observe integration includes diagnostics
  it('test_observe_includes_lsp_diagnostics', async () => {
    const manager = (runner as any).lspManager as LSPManager;
    expect(manager).toBeDefined();

    const testFile = 'logic.py';
    const params = {
      uri: `file://${path.resolve(projectPath, testFile).replace(/\\/g, '/')}`,
      diagnostics: [
        {
          severity: 1,
          message: 'Integration Test Error',
          range: { start: { line: 10, character: 5 } },
        },
      ],
    };
    (manager as any).updateDiagnostics(params);

    const ctx = (await runner.observe()).toMarkdown();
    expect(ctx).toContain('# CODE HEALTH');
    expect(ctx).toContain('Integration Test Error');
    expect(ctx).toContain('logic.py: 1 errors');
  });
});

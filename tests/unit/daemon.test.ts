import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DaemonClient } from '../../src/daemon/client.js';
import { resolveIpcPath } from '../../src/daemon/ipc.js';
import { DaemonServer } from '../../src/daemon/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Daemon IPC Protocol', () => {
  const tempDir = path.resolve(__dirname, 'temp-daemon-test');

  beforeAll(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should resolve a unique socket path based on workspace path hash', () => {
    const p1 = path.join(tempDir, 'project1');
    const p2 = path.join(tempDir, 'project2');

    const s1 = resolveIpcPath(p1);
    const s2 = resolveIpcPath(p2);

    expect(s1).not.toBe(s2);
    expect(s1).toContain('daemon-');
  });

  it('should start DaemonServer, connect with DaemonClient, and exchange JSON-RPC messages', async () => {
    const workspacePath = path.join(tempDir, 'test-workspace');
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.mkdirSync(path.join(workspacePath, '.aura', 'config'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspacePath, '.aura', 'config', 'config.yml'),
      'llm:\n  provider: local\n',
    );

    const server = new DaemonServer(workspacePath);
    await server.start();

    const client = new DaemonClient(workspacePath);
    // Auto launch false because we started the server manually
    await client.connect(false);

    // 1. Initialize
    const initRes = await client.request('workspace/initialize', {
      sessionName: 'test_session',
    });
    expect(initRes.initialized).toBe(true);
    expect(initRes.projectPath).toBe(path.resolve(workspacePath));
    expect(initRes.sessionName).toBe('test_session');

    // 2. Status
    const statusRes = await client.request('daemon/status');
    expect(statusRes.projectPath).toBe(path.resolve(workspacePath));
    expect(statusRes.activeSession).toBe('test_session');
    expect(statusRes.jobStatus).toBe('idle');
    expect(statusRes.connectionsCount).toBe(1);

    // 3. Close & exit
    const exitRes = await client.request('daemon/exit');
    expect(exitRes.exiting).toBe(true);

    client.disconnect();
    server.stop();
  });

  it('should handle Session, Filesystem, and Garden JSON-RPC API requests', async () => {
    const workspacePath = path.join(tempDir, 'test-workspace-rpc');
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.mkdirSync(path.join(workspacePath, '.aura', 'config'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspacePath, '.aura', 'config', 'config.yml'),
      'llm:\n  provider: local\n',
    );

    const server = new DaemonServer(workspacePath);
    await server.start();

    const client = new DaemonClient(workspacePath);
    await client.connect(false);

    // Initialize workspace
    await client.request('workspace/initialize', {
      sessionName: 'default',
    });

    // --- Session APIs ---
    // 1. Create session
    const createRes = await client.request('session/create', {
      name: 'test-rpc-session',
      description: 'Test session created via RPC',
      tags: ['test', 'rpc'],
    });
    expect(createRes.session).toBeDefined();
    expect(createRes.session.name).toBe('test-rpc-session');

    // 2. List sessions
    const listRes = await client.request('session/list');
    expect(listRes.sessions).toBeDefined();
    expect(listRes.sessions.some((s: any) => s.name === 'test-rpc-session')).toBe(true);

    // 3. Activate session
    const activateRes = await client.request('session/activate', {
      name: 'test-rpc-session',
    });
    expect(activateRes.activeSession).toBe('test-rpc-session');

    // 4. Duplicate session
    const dupRes = await client.request('session/duplicate', {
      sourceName: 'test-rpc-session',
      newName: 'test-rpc-session-copy',
    });
    expect(dupRes.session).toBeDefined();
    expect(dupRes.session.name).toBe('test-rpc-session-copy');

    // 5. Rename session
    const renameRes = await client.request('session/rename', {
      oldName: 'test-rpc-session-copy',
      newName: 'test-rpc-session-renamed',
    });
    expect(renameRes.session).toBeDefined();
    expect(renameRes.session.name).toBe('test-rpc-session-renamed');

    // 6. Delete session
    const deleteRes = await client.request('session/delete', {
      name: 'test-rpc-session-renamed',
    });
    expect(deleteRes.success).toBe(true);

    // --- Filesystem APIs ---
    // 1. Write file
    const writeRes = await client.request('workspace/writeFile', {
      path: 'test-file.txt',
      content: 'hello world from rpc',
    });
    expect(writeRes.success).toBe(true);

    // 2. Read file
    const readRes = await client.request('workspace/readFile', {
      path: 'test-file.txt',
    });
    expect(readRes.content).toBe('hello world from rpc');

    // 3. Get file tree
    const treeRes = await client.request('workspace/getFileTree');
    expect(treeRes.tree).toBeDefined();
    expect(treeRes.tree.some((n: any) => n.name === 'test-file.txt' && n.type === 'file')).toBe(true);

    // --- Garden/Anchor APIs ---
    // 1. Set up anchor file
    const anchorsDir = path.join(workspacePath, 'anchors');
    fs.mkdirSync(anchorsDir, { recursive: true });
    fs.writeFileSync(
      path.join(anchorsDir, 'test-anchor.json'),
      JSON.stringify({
        id: 'anchor-1',
        name: 'Test Anchor One',
        description: 'An anchor for testing JSON-RPC API',
        call_when: ['step 1'],
      }),
    );

    // 2. Submit anchor completion
    const submitRes = await client.request('garden/submitAnchor', {
      anchor_id: 'anchor-1',
      summary: 'completed step 1 successfully',
    });
    expect(submitRes.success).toBe(true);

    // 3. Get anchors list and verify completed
    const getAnchorsRes = await client.request('garden/getAnchors');
    expect(getAnchorsRes.anchors).toBeDefined();
    const testAnchor = getAnchorsRes.anchors.find((a: any) => a.id === 'anchor-1');
    expect(testAnchor).toBeDefined();
    expect(testAnchor.status).toBe('completed');
    expect(testAnchor.summary).toBe('completed step 1 successfully');

    // 4. Revoke/delete anchor completion
    const revokeRes = await client.request('garden/submitAnchor', {
      anchor_id: 'anchor-1',
      revoke: true,
    });
    expect(revokeRes.success).toBe(true);

    // 5. Verify anchor is back to pending
    const getAnchorsRes2 = await client.request('garden/getAnchors');
    const testAnchor2 = getAnchorsRes2.anchors.find((a: any) => a.id === 'anchor-1');
    expect(testAnchor2).toBeDefined();
    expect(testAnchor2.status).toBe('pending');

    // 6. Get garden status
    const statusRes = await client.request('garden/getStatus');
    expect(statusRes.soilSize).toBeDefined();
    expect(statusRes.sessionsCount).toBeGreaterThanOrEqual(1);
    expect(statusRes.anchorsProgress).toBeDefined();
    expect(statusRes.anchorsProgress.total).toBe(1);
    expect(statusRes.anchorsProgress.completed).toBe(0);
    expect(statusRes.activeHintsCount).toBeDefined();

    // Cleanup & Exit
    await client.request('daemon/exit');
    client.disconnect();
    server.stop();
  });

  it('should enforce security and safety bounds on daemon requests', async () => {
    const workspacePath = path.join(tempDir, 'test-workspace-safety');
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.mkdirSync(path.join(workspacePath, '.aura', 'config'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspacePath, '.aura', 'config', 'config.yml'),
      'llm:\n  provider: local\n',
    );

    const server = new DaemonServer(workspacePath);
    await server.start();

    const client = new DaemonClient(workspacePath);
    await client.connect(false);

    // Initialize workspace
    await client.request('workspace/initialize', {
      sessionName: 'default',
    });

    // 1. Invalid JSON-RPC request (bypass DaemonClient to write raw invalid JSON data)
    const socket = net.createConnection(server['socketPath']);
    await new Promise<void>((resolve) => {
      socket.on('connect', resolve);
    });

    const errorPromise = new Promise<string>((resolve) => {
      socket.on('data', (data) => {
        resolve(data.toString());
      });
    });

    socket.write('{"invalid": "data"}\n');
    const rawResponse = await errorPromise;
    const response = JSON.parse(rawResponse);
    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32600); // Invalid Request
    socket.destroy();

    // 2. Restricted path write access (writing under .aura should fail)
    await expect(
      client.request('workspace/writeFile', {
        path: '.aura/restricted.txt',
        content: 'should fail',
      })
    ).rejects.toThrow();

    // 3. Restricted path read access (reading under .git should fail)
    await expect(
      client.request('workspace/readFile', {
        path: '.git/config',
      })
    ).rejects.toThrow();

    // 4. Delete active session (should fail)
    await expect(
      client.request('session/delete', {
        name: 'default',
      })
    ).rejects.toThrow();

    // Cleanup & Exit
    await client.request('daemon/exit');
    client.disconnect();
    server.stop();
  });

  it('should only request confirmation for dangerous tools when security.confirm_dangerous_tools is enabled', async () => {
    const workspacePath = path.join(tempDir, 'test-workspace-confirm-tools');
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.mkdirSync(path.join(workspacePath, '.aura', 'config'), {
      recursive: true,
    });
    
    // Write config without security confirmation (disabled by default)
    fs.writeFileSync(
      path.join(workspacePath, '.aura', 'config', 'config.yml'),
      'llm:\n  provider: local\n',
    );

    const { Bridge } = await import('../../src/core/interface/bridge.js');

    // Spy/mock Bridge.prototype.chat to manually trigger tool execution hooks
    const chatSpy = vi.spyOn(Bridge.prototype, 'chat').mockImplementation(async function (this: any) {
      const allowed = await this.runner.hooks.run('before_tool_execution', 'write_file', { path: 'test.txt' });
      return allowed;
    });

    const server = new DaemonServer(workspacePath);
    await server.start();

    const client = new DaemonClient(workspacePath);
    await client.connect(false);

    await client.request('workspace/initialize', {
      sessionName: 'default',
    });

    // 1. Run goal with security.confirm_dangerous_tools unset (should return true immediately)
    const runRes1 = await client.request('agent/runGoal', {
      goal: 'write a file',
      options: { auto_mode: false }
    });
    expect(runRes1.status).toBe('completed');

    // 2. Now write config enabling confirmation
    fs.writeFileSync(
      path.join(workspacePath, '.aura', 'config', 'config.yml'),
      'llm:\n  provider: local\nsecurity:\n  confirm_dangerous_tools: true\n',
    );

    // Re-initialize runner with new config
    await client.request('workspace/initialize', {
      sessionName: 'default',
    });

    // Register confirmation response handler on client
    let confirmPromptReceived = false;
    client.onConfirmRequest(async (msg) => {
      confirmPromptReceived = true;
      return true; // approve dangerous tool
    });

    // Run goal with security.confirm_dangerous_tools = true (should ask client for confirmation)
    const runRes2 = await client.request('agent/runGoal', {
      goal: 'write a file',
      options: { auto_mode: false }
    });
    
    expect(confirmPromptReceived).toBe(true);
    expect(runRes2.status).toBe('completed');

    // Cleanup & Exit
    chatSpy.mockRestore();
    await client.request('daemon/exit');
    client.disconnect();
    server.stop();
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
});

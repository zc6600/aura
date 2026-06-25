import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'yaml';
import { Bridge } from '../../src/core/interface/bridge.js';
import { DaemonClient } from '../../src/daemon/client.js';
import { DaemonServer } from '../../src/daemon/server.js';
import { initializeWorkspaceInPlace } from '../../src/utils/workspaceInitializer.js';
import {
  createTestSandbox,
  type TestSandbox,
  withSandboxEnvAsync,
} from '../utils/testSandbox.js';

type BridgeCallbackMap = Record<string, (...args: any[]) => unknown>;
type ProcessListRpc = { processes: Array<{ pid: number }> };
type FileTreeNodeRpc = { path: string; children?: FileTreeNodeRpc[] };
type FileTreeRpc = { tree: FileTreeNodeRpc[] };

describe('Daemon advanced integration', { timeout: 30000 }, () => {
  let workspacePath: string;
  let sandbox: TestSandbox;
  let server: DaemonServer | null = null;
  const clients: DaemonClient[] = [];
  const children: ChildProcessWithoutNullStreams[] = [];

  beforeEach(async () => {
    sandbox = createTestSandbox('daemon-int');
    workspacePath = sandbox.workspace;
    await withSandboxEnvAsync(sandbox, async () => {
      await initializeWorkspaceInPlace(workspacePath);
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const client of clients.splice(0)) {
      client.disconnect();
    }
    for (const child of children.splice(0)) {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }
    if (server) {
      server.stop();
      server = null;
    }
    await sandbox.cleanup();
  });

  async function startClient(): Promise<DaemonClient> {
    return await withSandboxEnvAsync(sandbox, async () => {
      if (!server) {
        server = new DaemonServer(workspacePath);
        await server.start();
      }
      const client = new DaemonClient(workspacePath);
      await client.connect(false);
      clients.push(client);
      return client;
    });
  }

  async function initializedClient(): Promise<DaemonClient> {
    const client = await startClient();
    await client.request('workspace/initialize', { sessionName: 'default' });
    return client;
  }

  it('streams agent progress notifications and returns final content over IPC', async () => {
    vi.spyOn(Bridge.prototype, 'chat').mockImplementation(async function (
      this: Bridge,
    ) {
      const callbacks = (this as unknown as { callbacks: BridgeCallbackMap })
        .callbacks;
      callbacks.on_token?.('hello ');
      callbacks.on_tool_start?.('read_file', 'inspect file', {
        file_path: 'README.md',
      });
      callbacks.on_tool_result?.({ status: 'ok', content: 'done' });
      callbacks.on_final_answer?.('daemon final answer');
      callbacks.on_stream_end?.();
    });

    const client = await initializedClient();
    const notifications: Array<{
      method: string;
      params: Record<string, unknown>;
    }> = [];
    client.onNotification((method, params) => {
      notifications.push({ method, params });
    });

    const result = await client.request('agent/runGoal', {
      goal: 'stream progress',
      options: { auto_mode: false },
    });

    expect(result).toEqual({
      status: 'completed',
      final_content: 'daemon final answer',
    });
    expect(
      notifications.some(
        (item) =>
          item.method === 'agent/onProgress' &&
          (item.params as any).type === 'token' &&
          (item.params as any).payload?.text === 'hello ',
      ),
    ).toBe(true);
    expect(
      notifications.some(
        (item) =>
          item.method === 'agent/onProgress' &&
          (item.params as any).type === 'tool_start' &&
          (item.params as any).payload?.tool === 'read_file',
      ),
    ).toBe(true);
    expect(server?.activeLoopJob.status).toBe('idle');
  });

  it('aborts an active daemon goal when the client socket disconnects', async () => {
    vi.spyOn(Bridge.prototype, 'chat').mockImplementation(async function (
      this: Bridge,
    ) {
      const signal = this.runner.abortSignal;
      await new Promise<void>((resolve) => {
        if (signal?.aborted) {
          resolve();
          return;
        }
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      throw new Error('Client socket disconnected');
    });

    const client = await initializedClient();
    const request = client
      .request('agent/runGoal', {
        goal: 'wait until disconnected',
        options: { auto_mode: false },
      })
      .catch((error: Error) => error);

    await vi.waitFor(() => {
      expect(server?.activeLoopJob.status).toBe('running');
    });

    client.disconnect();
    const result = await request;
    expect(result).toBeInstanceOf(Error);

    await vi.waitFor(() => {
      expect(server?.activeLoopJob.status).toBe('idle');
    });

    const nextClient = await startClient();
    const status = await nextClient.request('daemon/status');
    expect(status.jobStatus).toBe('idle');
  });

  it('rejects a concurrent goal while another daemon goal is running', async () => {
    let releaseGoal: () => void = () => {};
    vi.spyOn(Bridge.prototype, 'chat').mockImplementation(async function (
      this: Bridge,
    ) {
      await new Promise<void>((resolve) => {
        releaseGoal = resolve;
      });
      const callbacks = (this as unknown as { callbacks: BridgeCallbackMap })
        .callbacks;
      callbacks.on_final_answer?.('released');
    });

    const clientA = await initializedClient();
    const clientB = await startClient();

    const firstRequest = clientA.request('agent/runGoal', {
      goal: 'hold loop open',
      options: { auto_mode: false },
    });

    await vi.waitFor(() => {
      expect(server?.activeLoopJob.status).toBe('running');
    });

    await expect(
      clientB.request('agent/runGoal', {
        goal: 'must be rejected',
        options: { auto_mode: false },
      }),
    ).rejects.toThrow(/already running/i);

    releaseGoal?.();
    const firstResult = await firstRequest;
    expect(firstResult.status).toBe('completed');
    expect(firstResult.final_content).toBe('released');
    expect(server?.activeLoopJob.status).toBe('idle');
  });

  it('broadcasts agent progress notifications to all connected daemon clients', async () => {
    vi.spyOn(Bridge.prototype, 'chat').mockImplementation(async function (
      this: Bridge,
    ) {
      const callbacks = (this as unknown as { callbacks: BridgeCallbackMap })
        .callbacks;
      callbacks.on_token?.('shared token');
      callbacks.on_stream_end?.();
      callbacks.on_final_answer?.('broadcast complete');
    });

    const activeClient = await initializedClient();
    const observerClient = await startClient();
    const activeNotifications: Array<{ method: string; params: any }> = [];
    const observerNotifications: Array<{ method: string; params: any }> = [];

    activeClient.onNotification((method, params) => {
      activeNotifications.push({ method, params });
    });
    observerClient.onNotification((method, params) => {
      observerNotifications.push({ method, params });
    });

    const result = await activeClient.request('agent/runGoal', {
      goal: 'broadcast progress',
      options: { auto_mode: false },
    });

    expect(result).toEqual({
      status: 'completed',
      final_content: 'broadcast complete',
    });
    await vi.waitFor(() => {
      expect(
        activeNotifications.some(
          (item) =>
            item.method === 'agent/onProgress' &&
            item.params?.type === 'token' &&
            item.params?.payload?.text === 'shared token',
        ),
      ).toBe(true);
      expect(
        observerNotifications.some(
          (item) =>
            item.method === 'agent/onProgress' &&
            item.params?.type === 'token' &&
            item.params?.payload?.text === 'shared token',
        ),
      ).toBe(true);
    });
  });

  it('does not abort the active daemon goal when an observer disconnects', async () => {
    let releaseGoal: () => void = () => {};
    vi.spyOn(Bridge.prototype, 'chat').mockImplementation(async function (
      this: Bridge,
    ) {
      await new Promise<void>((resolve) => {
        releaseGoal = resolve;
      });
      const callbacks = (this as unknown as { callbacks: BridgeCallbackMap })
        .callbacks;
      callbacks.on_final_answer?.('observer disconnected safely');
    });

    const activeClient = await initializedClient();
    const observerClient = await startClient();

    const request = activeClient.request('agent/runGoal', {
      goal: 'continue after observer leaves',
      options: { auto_mode: false },
    });

    await vi.waitFor(() => {
      expect(server?.activeLoopJob.status).toBe('running');
    });

    observerClient.disconnect();

    await vi.waitFor(() => {
      expect(server?.activeLoopJob.status).toBe('running');
    });

    releaseGoal?.();
    const result = await request;
    expect(result.status).toBe('completed');
    expect(result.final_content).toBe('observer disconnected safely');
    expect(server?.activeLoopJob.status).toBe('idle');
  });

  it('relays dangerous tool confirmation requests through the daemon client', async () => {
    vi.spyOn(Bridge.prototype, 'chat').mockImplementation(async function (
      this: Bridge,
    ) {
      const bridgeState = this as unknown as {
        runner: {
          runCall(call: {
            tool: string;
            args: Record<string, unknown>;
          }): Promise<unknown>;
        };
        callbacks: BridgeCallbackMap;
      };
      const result = await bridgeState.runner.runCall({
        tool: 'write_file',
        args: {
          file_path: 'confirmed.txt',
          content: 'approved by confirm hook\n',
        },
      });
      bridgeState.callbacks.on_final_answer?.(JSON.stringify(result));
    });

    const configPath = path.join(
      workspacePath,
      '.aura-workspace',
      'config',
      'config.yml',
    );
    const rawConfig = yaml.parse(fs.readFileSync(configPath, 'utf-8')) || {};
    rawConfig.security = {
      ...(rawConfig.security || {}),
      confirm_dangerous_tools: true,
    };
    fs.writeFileSync(configPath, yaml.stringify(rawConfig), 'utf-8');

    const client = await initializedClient();
    const confirmations: string[] = [];
    client.onConfirmRequest(async (message) => {
      confirmations.push(message);
      return true;
    });

    const result = await client.request('agent/runGoal', {
      goal: 'perform a confirmed write',
      options: { auto_mode: false },
    });

    expect(result.status).toBe('completed');
    expect(confirmations).toEqual(['DANGEROUS TOOL: write_file. Execute?']);
    expect(
      fs.readFileSync(path.join(workspacePath, 'confirmed.txt'), 'utf-8'),
    ).toContain('approved by confirm hook');
  });

  it('forwards interactive process prompt notifications over daemon IPC', async () => {
    vi.spyOn(Bridge.prototype, 'chat').mockImplementation(async function (
      this: Bridge,
    ) {
      const bridgeState = this as unknown as {
        runner: {
          getEngine(): { emit(event: string, payload: unknown): void };
        };
        callbacks: BridgeCallbackMap;
      };
      bridgeState.runner.getEngine().emit('interactive_prompt', {
        pid: 4242,
        prompt: 'Enter secret:',
        trigger: 'pattern_match',
      });
      bridgeState.callbacks.on_final_answer?.('interactive prompt delivered');
    });

    const client = await initializedClient();
    const prompts: Array<Record<string, unknown>> = [];
    client.onNotification((method, params) => {
      if (method === 'execute/onInteractivePrompt') {
        prompts.push(params);
      }
    });

    const result = await client.request('agent/runGoal', {
      goal: 'emit interactive prompt',
      options: { auto_mode: false },
    });

    expect(result.status).toBe('completed');
    expect(result.final_content).toBe('interactive prompt delivered');
    expect(prompts).toContainEqual({
      pid: 4242,
      prompt: 'Enter secret:',
      trigger: 'pattern_match',
    });
  });

  it('rejects workspace and session mutations while a daemon goal loop is running', async () => {
    let releaseGoal: () => void = () => {};
    vi.spyOn(Bridge.prototype, 'chat').mockImplementation(async function (
      this: Bridge,
    ) {
      await new Promise<void>((resolve) => {
        releaseGoal = resolve;
      });
      const callbacks = (this as unknown as { callbacks: BridgeCallbackMap })
        .callbacks;
      callbacks.on_final_answer?.('guards released');
    });

    const client = await initializedClient();
    await client.request('session/create', { name: 'alternate' });

    const request = client.request('agent/runGoal', {
      goal: 'hold loop to test mutation guards',
      options: { auto_mode: false },
    });

    await vi.waitFor(() => {
      expect(server?.activeLoopJob.status).toBe('running');
    });

    await expect(
      client.request('workspace/initialize', { sessionName: 'alternate' }),
    ).rejects.toThrow(
      /cannot initialize workspace while a goal loop is running/i,
    );

    await expect(
      client.request('session/activate', { name: 'alternate' }),
    ).rejects.toThrow(/cannot activate session while a goal loop is running/i);

    releaseGoal?.();
    const result = await request;
    expect(result.status).toBe('completed');
    expect(result.final_content).toBe('guards released');
    expect(server?.activeLoopJob.status).toBe('idle');
  });

  it('serves execute process RPCs over daemon IPC', async () => {
    const client = await initializedClient();
    const commandsDir = path.join(
      workspacePath,
      '.aura-workspace',
      'state',
      'commands',
    );
    fs.mkdirSync(commandsDir, { recursive: true });

    const child = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ]);
    children.push(child);

    const stdoutFile = path.join(commandsDir, `${child.pid}.out`);
    const stderrFile = path.join(commandsDir, `${child.pid}.err`);
    fs.writeFileSync(stdoutFile, 'initial stdout line\n', 'utf-8');
    fs.writeFileSync(stderrFile, 'initial stderr line\n', 'utf-8');
    fs.writeFileSync(
      path.join(commandsDir, `${child.pid}.json`),
      JSON.stringify(
        {
          pid: child.pid,
          command: 'node long-running-test',
          cwd: workspacePath,
          started_at: Date.now() / 1000,
          stdout_file: stdoutFile,
          stderr_file: stderrFile,
          status: 'running',
        },
        null,
        2,
      ),
      'utf-8',
    );

    const list = await client.request<ProcessListRpc>('execute/listProcesses');
    expect(list.processes.some((item) => item.pid === child.pid)).toBe(true);

    const logs = await client.request('execute/getProcessLogs', {
      pid: child.pid,
      limit: 10,
    });
    expect(logs.stdout).toContain('initial stdout line');
    expect(logs.stderr).toContain('initial stderr line');

    const seenLogs: string[] = [];
    client.onNotification((method, params) => {
      if (method === 'execute/onLog') {
        seenLogs.push(String((params as any).line || ''));
      }
    });
    const subscribed = await client.request('execute/subscribeLogs', {
      pid: child.pid,
    });
    expect(subscribed.subscribed).toBe(true);
    await vi.waitFor(() => {
      expect(seenLogs.join('\n')).toContain('initial stdout line');
    });

    const killed = await client.request('execute/killProcess', {
      pid: child.pid,
      signal: 'SIGTERM',
    });
    expect(killed.success).toBe(true);
  });

  it('returns stable errors for raw JSON-RPC protocol violations', async () => {
    const client = await initializedClient();
    client.disconnect();

    if (!server) {
      throw new Error('server was not started');
    }
    const socket = net.createConnection(server.socketPath);
    const rl = readline.createInterface({ input: socket, terminal: false });
    const responses: any[] = [];
    rl.on('line', (line) => {
      responses.push(JSON.parse(line));
    });

    await new Promise<void>((resolve) => socket.on('connect', resolve));

    socket.write('{bad json\n');
    await vi.waitFor(() => {
      expect(responses[0]?.error?.code).toBe(-32700);
    });

    socket.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'unknown/method' })}\n`,
    );
    await vi.waitFor(() => {
      expect(responses[1]?.error?.code).toBe(-32601);
    });

    socket.write(`${JSON.stringify({ id: 3, method: 'daemon/status' })}\n`);
    await vi.waitFor(() => {
      expect(responses[2]?.error?.code).toBe(-32600);
    });

    socket.destroy();
    rl.close();
  });

  it('filters ignored entries and deep descendants from workspace file tree', async () => {
    const client = await initializedClient();

    fs.writeFileSync(path.join(workspacePath, 'visible.txt'), 'visible');
    fs.writeFileSync(path.join(workspacePath, '.hidden.txt'), 'hidden');
    fs.mkdirSync(path.join(workspacePath, 'node_modules', 'pkg'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspacePath, 'node_modules', 'pkg', 'ignored.txt'),
      'ignored',
    );
    fs.mkdirSync(path.join(workspacePath, 'deep', 'a', 'b', 'c', 'd'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspacePath, 'deep', 'a', 'b', 'c', 'd', 'too-deep.txt'),
      'too deep',
    );

    const result = await client.request<FileTreeRpc>('workspace/getFileTree');
    const paths: string[] = [];
    const collect = (nodes: FileTreeNodeRpc[]) => {
      for (const node of nodes) {
        paths.push(node.path);
        if (node.children) {
          collect(node.children);
        }
      }
    };
    collect(result.tree);

    expect(paths).toContain('visible.txt');
    expect(paths).not.toContain('.hidden.txt');
    expect(paths.some((item) => item.startsWith('node_modules'))).toBe(false);
    expect(paths).not.toContain('deep/a/b/c/d/too-deep.txt');
  });

  it('serves workspace read and write RPCs through kernel workspace runtime', async () => {
    const client = await initializedClient();
    const token = `AURA_WORKSPACE_RUNTIME_${Date.now()}`;

    const write = await client.request('workspace/writeFile', {
      path: 'notes/runtime.txt',
      content: `runtime token: ${token}\n`,
    });
    expect(write.success).toBe(true);

    const targetPath = path.join(workspacePath, 'notes', 'runtime.txt');
    expect(fs.readFileSync(targetPath, 'utf-8')).toContain(token);

    const read = await client.request('workspace/readFile', {
      path: 'notes/runtime.txt',
    });
    expect(read.content).toContain(token);
  });

  it('rejects restricted workspace paths through workspace runtime', async () => {
    const client = await initializedClient();

    await expect(
      client.request('workspace/writeFile', {
        path: '.aura/config/blocked.txt',
        content: 'blocked',
      }),
    ).rejects.toThrow(/access denied|restricted path/i);

    expect(
      fs.existsSync(path.join(workspacePath, '.aura', 'config', 'blocked.txt')),
    ).toBe(false);
  });

  it('removes a stale socket path before starting a daemon server', async () => {
    server = new DaemonServer(workspacePath);
    fs.mkdirSync(path.dirname(server.socketPath), { recursive: true });
    fs.writeFileSync(server.socketPath, 'stale socket placeholder', 'utf-8');

    await server.start();

    const client = new DaemonClient(workspacePath);
    await client.connect(false);
    clients.push(client);
    const status = await client.request('daemon/status');
    expect(status.projectPath).toBe(path.resolve(workspacePath));
  });

  it('rejects pending client requests when the daemon socket closes', async () => {
    vi.spyOn(Bridge.prototype, 'chat').mockImplementation(async () => {
      await new Promise<void>(() => {});
    });

    const client = await initializedClient();
    const pending = client
      .request('agent/runGoal', {
        goal: 'never completes',
        options: { auto_mode: false },
      })
      .catch((error: Error) => error);

    await vi.waitFor(() => {
      expect(server?.activeLoopJob.status).toBe('running');
    });

    server?.stop();
    server = null;

    const result = await pending;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/connection.*closed/i);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { DaemonClient } from '../../../src/daemon/client.js';
import { DaemonServer } from '../../../src/daemon/server.js';
import {
  createSystemWorkspace,
  requireSystemLlmConfig,
  runSystemTests,
  type SystemWorkspace,
} from '../utils/systemHarness.js';

const describeSystem = runSystemTests ? describe : describe.skip;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}

describeSystem('System daemon runtime', { timeout: 240000 }, () => {
  let workspace: SystemWorkspace;
  let server: DaemonServer | null = null;
  let client: DaemonClient | null = null;
  let previousEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    workspace = await createSystemWorkspace(
      'daemon-runtime',
      requireSystemLlmConfig(),
    );
    previousEnv = {};
    for (const [key, value] of Object.entries(workspace.env)) {
      previousEnv[key] = process.env[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    server = new DaemonServer(workspace.root);
    await server.start();
    client = new DaemonClient(workspace.root);
    await client.connect(false);
    await client.request('workspace/initialize', { sessionName: 'default' });
  });

  afterEach(async () => {
    client?.disconnect();
    client = null;
    server?.stop();
    server = null;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    previousEnv = {};
    await workspace.cleanup();
  });

  it('completes a real LLM final-answer task through daemon IPC', async () => {
    if (!client) {
      throw new Error('daemon client was not initialized');
    }
    const token = `AURA_DAEMON_SMOKE_${Date.now()}`;
    const notifications: Array<{
      method: string;
      params: Record<string, unknown>;
    }> = [];
    client?.onNotification((method, params) => {
      notifications.push({ method, params });
    });

    const result = await withTimeout(
      client.request('agent/runGoal', {
        goal: `Reply with only this exact token and do not call tools: ${token}`,
        options: { auto_mode: true },
      }),
      180_000,
      'daemon smoke goal',
    );

    expect(result.status).toBe('completed');
    expect(result.final_content || '').toContain(token);
    expect(
      notifications.some((item) => item.method === 'agent/onProgress'),
    ).toBe(true);

    const status = await client.request('daemon/status');
    expect(status.jobStatus).toBe('idle');
  });

  it('uses a real LLM daemon loop to create a file with write_file', async () => {
    if (!client) {
      throw new Error('daemon client was not initialized');
    }
    const token = `AURA_DAEMON_FILE_${Date.now()}`;
    const targetPath = path.join(workspace.root, 'daemon-output.txt');
    const notifications: Array<{
      method: string;
      params: Record<string, unknown>;
    }> = [];
    client?.onNotification((method, params) => {
      notifications.push({ method, params });
    });

    const result = await withTimeout(
      client.request('agent/runGoal', {
        goal: [
          'Use the write_file tool to create daemon-output.txt.',
          `The file content must contain exactly this token: ${token}.`,
          'After the file is written, finish with a concise final answer.',
        ].join(' '),
        options: { auto_mode: true },
      }),
      180_000,
      'daemon write_file goal',
    );

    expect(result.status).toBe('completed');
    expect(fs.existsSync(targetPath)).toBe(true);
    expect(fs.readFileSync(targetPath, 'utf-8')).toContain(token);
    expect(
      notifications.some(
        (item) =>
          item.method === 'agent/onProgress' &&
          (item.params as any).type === 'tool_start' &&
          (item.params as any).payload?.tool === 'write_file',
      ),
    ).toBe(true);

    const status = await client.request('daemon/status');
    expect(status.jobStatus).toBe('idle');
  });

  it('honors daemon dangerous-tool confirmation decisions', async () => {
    if (!client) {
      throw new Error('daemon client was not initialized');
    }
    const rawConfig = yaml.parse(
      fs.readFileSync(workspace.configPath, 'utf-8'),
    );
    rawConfig.security = {
      ...(rawConfig.security || {}),
      confirm_dangerous_tools: true,
    };
    fs.writeFileSync(workspace.configPath, yaml.stringify(rawConfig), 'utf-8');
    await client.request('workspace/initialize', { sessionName: 'default' });

    const deniedToken = `AURA_DAEMON_DENIED_${Date.now()}`;
    const deniedPath = path.join(workspace.root, 'daemon-denied.txt');
    let denyPromptCount = 0;
    client.onConfirmRequest(async () => {
      denyPromptCount++;
      return false;
    });

    await withTimeout(
      client.request('agent/runGoal', {
        goal: [
          'Use the write_file tool to create daemon-denied.txt.',
          `The file content must contain exactly this token: ${deniedToken}.`,
          'After the tool attempt, finish briefly.',
        ].join(' '),
        options: { auto_mode: false },
      }),
      180_000,
      'daemon denied confirmation goal',
    );

    expect(denyPromptCount).toBeGreaterThan(0);
    expect(fs.existsSync(deniedPath)).toBe(false);

    const approvedToken = `AURA_DAEMON_APPROVED_${Date.now()}`;
    const approvedPath = path.join(workspace.root, 'daemon-approved.txt');
    let approvePromptCount = 0;
    client.onConfirmRequest(async () => {
      approvePromptCount++;
      return true;
    });

    const approved = await withTimeout(
      client.request('agent/runGoal', {
        goal: [
          'Use the write_file tool to create daemon-approved.txt.',
          `The file content must contain exactly this token: ${approvedToken}.`,
          'After the file is written, finish briefly.',
        ].join(' '),
        options: { auto_mode: false },
      }),
      180_000,
      'daemon approved confirmation goal',
    );

    expect(approved.status).toBe('completed');
    expect(approvePromptCount).toBeGreaterThan(0);
    expect(fs.existsSync(approvedPath)).toBe(true);
    expect(fs.readFileSync(approvedPath, 'utf-8')).toContain(approvedToken);
  });
});

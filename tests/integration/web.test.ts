import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const auraBinPath = path.resolve(__dirname, '../../src/bin/aura.ts');
process.env.AURA_ALLOW_ROOT = 'true';

describe('Web Server Integration', { timeout: 30000 }, () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'aura-web-integration-'),
    );

    // 1. Initialize workspace via CLI
    const res = await execa('npx', ['tsx', auraBinPath, 'new', projectPath]);
    expect(res.exitCode).toBe(0);

    // 2. Run once to populate at least one event in database
    const payload = JSON.stringify({
      tool: 'read_file',
      args: { file_path: '.aura-workspace/config/config.yml' },
      summary: 'Read config file',
    });
    const resOnce = await execa('npx', [
      'tsx',
      auraBinPath,
      'kernel',
      'once',
      projectPath,
      '-c',
      payload,
    ]);
    expect(resOnce.exitCode).toBe(0);
  }, 30000);

  afterEach(() => {
    try {
      if (fs.existsSync(projectPath)) {
        fs.rmSync(projectPath, { recursive: true, force: true });
      }
    } catch (_e) {}
  });

  async function getFreePort(): Promise<number> {
    return new Promise((resolve) => {
      const server = http.createServer();
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address !== 'string') {
          const port = address.port;
          server.close(() => resolve(port));
        }
      });
    });
  }

  async function waitForPort(port: number, retries = 50): Promise<void> {
    for (let i = 0; i < retries; i++) {
      try {
        await new Promise<void>((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${port}/events`, (res) => {
            res.resume();
            resolve();
          });
          req.on('error', (err) => reject(err));
        });
        return;
      } catch (_e) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error(`Web server did not start on port ${port}`);
  }

  it('serves events and shuts down gracefully via API', async () => {
    const port = await getFreePort();

    // Spawn server process
    const child = execa('npx', [
      'tsx',
      auraBinPath,
      'web',
      projectPath,
      '--port',
      String(port),
      '--host',
      '127.0.0.1',
    ]);

    try {
      await waitForPort(port);

      // Query /events
      const responseText = await new Promise<string>((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${port}/events`, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve(data));
          })
          .on('error', reject);
      });

      const eventsData = JSON.parse(responseText);
      expect(eventsData.tail).toBeDefined();
      expect(responseText).toContain('phase');

      // Trigger graceful shutdown
      await new Promise<void>((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${port}/shutdown`, (res) => {
            res.resume();
            resolve();
          })
          .on('error', reject);
      });

      // Wait for child to exit
      const exitResult = await child;
      expect(exitResult.exitCode).toBe(0);
    } finally {
      // Force kill just in case
      child.kill('SIGKILL');
    }
  });
});

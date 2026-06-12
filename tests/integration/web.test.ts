import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
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

  it('serves events, handles CORS restrictions, switches sessions dynamically, and shuts down gracefully', async () => {
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

      // Query helper with specific headers
      const queryWithHeaders = (
        pathStr: string,
        headers: http.OutgoingHttpHeaders = {},
      ): Promise<{ body: string; headers: http.IncomingHttpHeaders }> => {
        return new Promise((resolve, reject) => {
          const options = {
            hostname: '127.0.0.1',
            port,
            path: pathStr,
            method: 'GET',
            headers,
          };
          const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve({ body: data, headers: res.headers }));
          });
          req.on('error', reject);
          req.end();
        });
      };

      // 1. Verify standard event serving
      const resNormal = await queryWithHeaders('/events');
      const eventsData = JSON.parse(resNormal.body);
      expect(eventsData.tail).toBeDefined();
      expect(resNormal.body).toContain('phase');

      // 2. Verify CORS Restrictions
      // A. Authorized Origin: localhost
      const resLocalhost = await queryWithHeaders('/events', {
        Origin: 'http://localhost:3000',
      });
      expect(resLocalhost.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );

      // B. Authorized Origin: 127.0.0.1
      const resLoopback = await queryWithHeaders('/events', {
        Origin: 'http://127.0.0.1:8080',
      });
      expect(resLoopback.headers['access-control-allow-origin']).toBe(
        'http://127.0.0.1:8080',
      );

      // C. Unauthorized Origin: malicious.com -> Falls back to 127.0.0.1 (safe default)
      const resMalicious = await queryWithHeaders('/events', {
        Origin: 'http://malicious.com',
      });
      expect(resMalicious.headers['access-control-allow-origin']).toBe(
        'http://127.0.0.1',
      );

      // D. Missing Origin -> Falls back to 127.0.0.1
      expect(resNormal.headers['access-control-allow-origin']).toBe(
        'http://127.0.0.1',
      );

      // 3. Verify Session Switch & Dynamic Re-binding
      // Resolve the state path
      const stateDir = path.join(projectPath, '.aura-workspace', 'state');
      const activeSessionFile = path.join(stateDir, 'active_session.txt');
      const sessionsDir = path.join(stateDir, 'sessions');

      // Create a secondary custom session database
      fs.mkdirSync(sessionsDir, { recursive: true });
      const customDbPath = path.join(sessionsDir, 'custom-session.db');
      const db = new Database(customDbPath);
      db.exec(
        'CREATE TABLE events (id INTEGER PRIMARY KEY, phase TEXT, payload TEXT)',
      );
      db.prepare('INSERT INTO events (phase, payload) VALUES (?, ?)').run(
        'custom-session',
        JSON.stringify({ text: 'Hello from custom session!' }),
      );
      db.close();

      // Switch active session
      fs.writeFileSync(activeSessionFile, 'custom-session');

      // Request status and events, confirming they dynamically switch
      const resStatus = await queryWithHeaders('/api/status');
      const statusData = JSON.parse(resStatus.body);
      expect(statusData.session_name).toBe('custom-session');

      const resCustomEvents = await queryWithHeaders('/events');
      expect(resCustomEvents.body).toContain('Hello from custom session!');

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

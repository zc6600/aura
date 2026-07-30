import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import yaml from 'yaml';
import {
  type MemorySession,
  openMemorySession,
} from '../../core/memory/session.js';
import { VERSION } from '../../index.js';
import * as PathResolver from '../../utils/pathResolver.js';
import { errorMessage } from '../../utils/typing.js';

/** Finds the package root dynamically by climbing up looking for package.json. */
function findPackageRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

const currentFileDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = findPackageRoot(currentFileDir);

/** Resolves the dashboard's static asset directory (dev source vs. built dist). */
function getDashboardAssetsDir(): string {
  const devPath = path.join(packageRoot, 'src', 'cli', 'shell', 'dashboard');
  if (fs.existsSync(devPath)) return devPath;

  const prodPath = path.join(packageRoot, 'dist', 'dashboard');
  if (fs.existsSync(prodPath)) return prodPath;

  return path.join(currentFileDir, 'dashboard');
}

const DASHBOARD_ASSETS: Record<string, { file: string; contentType: string }> =
  {
    '/styles.css': {
      file: 'styles.css',
      contentType: 'text/css; charset=utf-8',
    },
    '/app.js': {
      file: 'app.js',
      contentType: 'application/javascript; charset=utf-8',
    },
  };

export class WebServer {
  private projectPath: string;
  private port: number;
  private host: string;
  private running = true;
  private envPath: string;
  private dbPath: string;
  private projectName: string;
  private server?: http.Server;
  private sessionInstance: MemorySession | null = null;
  private cachedDbPath: string | null = null;
  private dashboardAssetCache = new Map<string, string>();

  constructor(projectPath: string, port = 9299, host = '127.0.0.1') {
    this.projectPath = path.resolve(projectPath);
    this.port = port;
    this.host = host;
    this.envPath =
      PathResolver.environmentPath(this.projectPath) || this.projectPath;
    this.dbPath = PathResolver.sessionDbPath(this.projectPath);
    this.projectName = this.extractProjectName();
  }

  private getDbPath(): string {
    this.dbPath = PathResolver.sessionDbPath(this.projectPath);
    return this.dbPath;
  }

  private getSession(): MemorySession | null {
    const currentPath = this.getDbPath();
    if (!fs.existsSync(currentPath)) {
      if (this.sessionInstance) {
        this.closeDb();
      }
      return null;
    }

    if (this.sessionInstance && this.cachedDbPath === currentPath) {
      return this.sessionInstance;
    }

    this.closeDb();
    try {
      this.sessionInstance = openMemorySession({
        dbPath: currentPath,
        readonly: true,
      });
      this.cachedDbPath = currentPath;
      return this.sessionInstance;
    } catch (err) {
      console.error(`Failed to open database at ${currentPath}:`, err);
      return null;
    }
  }

  private closeDb(): void {
    if (this.sessionInstance) {
      try {
        this.sessionInstance.close();
      } catch (_err) {
        // ignore
      }
      this.sessionInstance = null;
    }
    this.cachedDbPath = null;
  }

  private getCorsOrigin(origin?: string): string {
    if (!origin) return 'http://127.0.0.1';
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return origin;
    }
    return 'http://127.0.0.1';
  }

  private async fileExists(p: string): Promise<boolean> {
    try {
      await fsPromises.access(p, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private readDashboardAsset(fileName: string): string {
    const cached = this.dashboardAssetCache.get(fileName);
    if (cached !== undefined) return cached;

    const filePath = path.join(getDashboardAssetsDir(), fileName);
    const content = fs.readFileSync(filePath, 'utf-8');
    this.dashboardAssetCache.set(fileName, content);
    return content;
  }

  public start(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.setupSignalHandlers();

      this.server = http.createServer(async (req, res) => {
        const urlObj = new URL(
          req.url || '/',
          `http://${this.host}:${this.port}`,
        );
        const method = req.method || 'GET';
        const pathname = urlObj.pathname;

        const reqOrigin = req.headers.origin;
        const allowedOrigin = this.getCorsOrigin(reqOrigin);

        // Handle CORS preflight
        if (method === 'OPTIONS') {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': allowedOrigin,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
          });
          res.end();
          return;
        }

        // Add common CORS headers to all JSON API responses
        const jsonHeaders = {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': allowedOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        };

        console.log(
          `[${new Date().toLocaleTimeString()}] ${method} ${pathname}`,
        );

        try {
          if (pathname === '/events') {
            let body = '';
            const session = this.getSession();
            if (session) {
              try {
                body = session
                  .eventTail(50)
                  .map((row) => row.payload)
                  .join('\n');
              } catch (_err) {
                // ignore
              }
            }
            res.writeHead(200, jsonHeaders);
            res.end(JSON.stringify({ tail: body }));
          } else if (pathname === '/diff') {
            const diff = await this.getDiff();
            res.writeHead(200, jsonHeaders);
            res.end(JSON.stringify({ diff }));
          } else if (pathname === '/sse') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'Access-Control-Allow-Origin': allowedOrigin,
            });
            res.flushHeaders();

            let lastId = 0;
            const interval = setInterval(() => {
              if (!this.running || res.destroyed) {
                clearInterval(interval);
                if (!res.destroyed) {
                  res.end();
                }
                return;
              }
              const session = this.getSession();
              if (session) {
                try {
                  const rows = session.eventsSince(lastId);
                  for (const row of rows) {
                    if (res.destroyed) {
                      break;
                    }
                    res.write(`data: ${row.payload}\n\n`);
                    lastId = Number(row.id);
                  }
                } catch (e: unknown) {
                  if (!res.destroyed) {
                    try {
                      res.write(`event: error\ndata: ${errorMessage(e)}\n\n`);
                    } catch {}
                  }
                }
              }
            }, 500);

            req.on('close', () => {
              clearInterval(interval);
            });
          } else if (pathname === '/shutdown') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('shutting down');
            setTimeout(() => this.stop(), 200);
          } else if (pathname === '/api/sessions') {
            let sessions: string[] = [];
            const session = this.getSession();
            if (session) {
              try {
                sessions = session.distinctPhases(20);
              } catch (_err) {
                // ignore
              }
            }
            res.writeHead(200, jsonHeaders);
            res.end(JSON.stringify({ sessions }));
          } else if (pathname.startsWith('/api/sessions/')) {
            const sessionId = pathname.substring('/api/sessions/'.length);
            let events: unknown[] = [];
            const session = this.getSession();
            if (session) {
              try {
                const rows = session.eventsByPhase(sessionId);
                events = rows.map((r) => {
                  try {
                    return JSON.parse(r.payload);
                  } catch {
                    return r.payload;
                  }
                });
              } catch (_err) {
                // ignore
              }
            }
            res.writeHead(200, jsonHeaders);
            res.end(JSON.stringify({ session_id: sessionId, events }));
          } else if (pathname === '/api/status') {
            const status = await this.getStatusInfo();
            res.writeHead(200, jsonHeaders);
            res.end(JSON.stringify(status));
          } else if (pathname in DASHBOARD_ASSETS) {
            const asset = DASHBOARD_ASSETS[pathname];
            res.writeHead(200, { 'Content-Type': asset.contentType });
            res.end(this.readDashboardAsset(asset.file));
          } else {
            // Serve dashboard HTML (SPA-style fallback for any other path)
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.readDashboardAsset('index.html'));
          }
        } catch (e: unknown) {
          console.error(`Error handling ${pathname}: ${errorMessage(e)}`);
          res.writeHead(500, jsonHeaders);
          res.end(
            JSON.stringify({ error: errorMessage(e), timestamp: Date.now() }),
          );
        }
      });

      this.server.on('close', () => {
        resolve();
      });

      this.server.listen(this.port, this.host, () => {
        console.log(`Aura Web listening at http://${this.host}:${this.port}/`);
      });
    });
  }

  public stop(): void {
    this.running = false;
    console.log('\nShutting down Aura Web server...');
    this.closeDb();
    if (this.server) {
      this.server.close(() => {
        console.log('Server stopped.');
      });
    }
  }

  private extractProjectName(): string {
    const cfgFile = path.join(this.envPath, 'config', 'config.yml');
    const defaultName = path.basename(this.projectPath);
    if (!fs.existsSync(cfgFile)) {
      return defaultName;
    }
    try {
      const parsed = yaml.parse(fs.readFileSync(cfgFile, 'utf-8'));
      return parsed?.project_name || defaultName;
    } catch {
      return defaultName;
    }
  }

  private async getStatusInfo() {
    let totalEvents = 0;
    let totalSessions = 0;
    const cfgFile = PathResolver.resolveConfigPath(this.projectPath) || '';
    let cfg: Record<string, unknown> = {};
    if (cfgFile && (await this.fileExists(cfgFile))) {
      try {
        const parsed = yaml.parse(await fsPromises.readFile(cfgFile, 'utf-8'));
        cfg =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
      } catch {}
    }
    const llmConfig =
      cfg.llm && typeof cfg.llm === 'object'
        ? (cfg.llm as Record<string, unknown>)
        : {};

    const currentPath = this.getDbPath();
    const dbExists = await this.fileExists(currentPath);
    if (dbExists) {
      const session = this.getSession();
      if (session) {
        try {
          totalEvents = session.stats().eventCount;
          totalSessions = session.distinctPhases().length;
        } catch {
          // ignore
        }
      }
    }

    let dbSize = 0;
    if (dbExists) {
      try {
        const stats = await fsPromises.stat(currentPath);
        dbSize = stats.size;
      } catch {}
    }

    return {
      project_name: this.projectName,
      project_path: this.projectPath,
      session_name: path.basename(currentPath, '.db'),
      db_size: dbSize,
      model: llmConfig.model || 'Unknown',
      provider: llmConfig.provider || 'Unknown',
      temperature:
        llmConfig.temperature !== undefined ? llmConfig.temperature : 0.7,
      total_events: totalEvents,
      total_sessions: totalSessions,
      node_version: process.version,
      version: VERSION,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  private async getDiff(): Promise<string> {
    const shadowPath = path.join(this.envPath, 'shadow');
    let diffBody = 'No changes recorded in the shadow workspace yet.';

    if (await this.fileExists(path.join(shadowPath, '.git'))) {
      try {
        const { stdout, exitCode } = await execa(
          'git',
          ['diff', 'HEAD~1', 'HEAD'],
          { cwd: shadowPath, reject: false },
        );
        if (exitCode === 0 && stdout.trim().length > 0) {
          diffBody = stdout;
        } else {
          const { stdout: stdoutUnstaged, exitCode: exitCodeUnstaged } =
            await execa('git', ['diff'], { cwd: shadowPath, reject: false });
          if (exitCodeUnstaged === 0 && stdoutUnstaged.trim().length > 0) {
            diffBody = stdoutUnstaged;
          }
        }
      } catch (e: unknown) {
        diffBody = `Error querying diff: ${errorMessage(e)}`;
      }
    }
    return diffBody;
  }

  private setupSignalHandlers(): void {
    const handler = () => {
      console.log(
        '\n\x1b[33mReceived shutdown signal. Shutting down gracefully...\x1b[0m',
      );
      this.stop();
    };
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
  }
}

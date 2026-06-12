import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import Database from 'better-sqlite3';
import { execa } from 'execa';
import yaml from 'yaml';
import { VERSION } from '../../index.js';
import * as PathResolver from '../../utils/pathResolver.js';

export class WebServer {
  private projectPath: string;
  private port: number;
  private host: string;
  private running = true;
  private envPath: string;
  private dbPath: string;
  private projectName: string;
  private server?: http.Server;
  private dbInstance: Database.Database | null = null;
  private cachedDbPath: string | null = null;

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

  private getDb(): Database.Database | null {
    const currentPath = this.getDbPath();
    if (!fs.existsSync(currentPath)) {
      if (this.dbInstance) {
        this.closeDb();
      }
      return null;
    }

    if (this.dbInstance && this.cachedDbPath === currentPath) {
      return this.dbInstance;
    }

    this.closeDb();
    try {
      this.dbInstance = new Database(currentPath, { readonly: true });
      this.cachedDbPath = currentPath;
      return this.dbInstance;
    } catch (err) {
      console.error(`Failed to open database at ${currentPath}:`, err);
      return null;
    }
  }

  private closeDb(): void {
    if (this.dbInstance) {
      try {
        this.dbInstance.close();
      } catch (_err) {
        // ignore
      }
      this.dbInstance = null;
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
            const db = this.getDb();
            if (db) {
              try {
                const rows = db
                  .prepare(
                    'SELECT payload FROM events ORDER BY id DESC LIMIT 50',
                  )
                  .all() as { payload: string }[];
                const lines = rows.map((r) => r.payload);
                body = lines.reverse().join('\n');
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
              const db = this.getDb();
              if (db) {
                try {
                  const rows = db
                    .prepare(
                      'SELECT id, payload FROM events WHERE id > ? ORDER BY id ASC',
                    )
                    .all(lastId) as { id: number; payload: string }[];
                  for (const row of rows) {
                    if (res.destroyed) {
                      break;
                    }
                    res.write(`data: ${row.payload}\n\n`);
                    lastId = Number(row.id);
                  }
                } catch (e: any) {
                  if (!res.destroyed) {
                    try {
                      res.write(`event: error\ndata: ${e.message}\n\n`);
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
            const db = this.getDb();
            if (db) {
              try {
                const rows = db
                  .prepare(
                    "SELECT DISTINCT phase FROM events WHERE phase IS NOT NULL AND phase != '' ORDER BY phase DESC LIMIT 20",
                  )
                  .all() as { phase: string }[];
                sessions = rows.map((r) => r.phase);
              } catch (_err) {
                // ignore
              }
            }
            res.writeHead(200, jsonHeaders);
            res.end(JSON.stringify({ sessions }));
          } else if (pathname.startsWith('/api/sessions/')) {
            const sessionId = pathname.substring('/api/sessions/'.length);
            let events: any[] = [];
            const db = this.getDb();
            if (db) {
              try {
                const rows = db
                  .prepare(
                    'SELECT payload FROM events WHERE phase = ? ORDER BY id ASC',
                  )
                  .all(sessionId) as { payload: string }[];
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
          } else {
            // Serve dashboard HTML
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.buildDashboardHtml());
          }
        } catch (e: any) {
          console.error(`Error handling ${pathname}: ${e.message}`);
          res.writeHead(500, jsonHeaders);
          res.end(JSON.stringify({ error: e.message, timestamp: Date.now() }));
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
    let cfg: any = {};
    if (cfgFile && (await this.fileExists(cfgFile))) {
      try {
        cfg = yaml.parse(await fsPromises.readFile(cfgFile, 'utf-8')) || {};
      } catch {}
    }
    const llmConfig = cfg.llm || {};

    const currentPath = this.getDbPath();
    const dbExists = await this.fileExists(currentPath);
    if (dbExists) {
      const db = this.getDb();
      if (db) {
        try {
          const countRow = db
            .prepare('SELECT COUNT(*) as count FROM events')
            .get() as { count: number };
          totalEvents = countRow?.count || 0;
          const sessionsRow = db
            .prepare(
              "SELECT DISTINCT phase FROM events WHERE phase IS NOT NULL AND phase != ''",
            )
            .all() as { phase: string }[];
          totalSessions = sessionsRow.length;
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
      } catch (e: any) {
        diffBody = `Error querying diff: ${e.message}`;
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

  private buildDashboardHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aura OS - Developer Console</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #070814;
      --bg-card: rgba(18, 19, 38, 0.45);
      --border: rgba(255, 255, 255, 0.06);
      --text: #f1f1f6;
      --text-muted: #8e90a6;
      --accent-primary: #00f2fe;
      --accent-secondary: #4facfe;
      --accent-glow: rgba(0, 242, 254, 0.15);
      --success: #10b981;
      --error: #f43f5e;
      --warning: #f59e0b;
      --plan: #a855f7;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background: radial-gradient(circle at 50% 0%, #11122a 0%, var(--bg-primary) 80%);
      color: var(--text);
      font-family: 'Outfit', sans-serif;
      min-height: 100vh;
      max-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.01);
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.08);
      border-radius: 99px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: var(--accent-primary);
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 32px;
      background: rgba(7, 8, 20, 0.6);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border);
      z-index: 100;
      height: 64px;
    }

    .header-logo {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-icon {
      width: 24px;
      height: 24px;
      fill: url(#logo-grad);
    }

    .header-logo span {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .connection-status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 500;
      background: rgba(255, 255, 255, 0.03);
      padding: 6px 14px;
      border-radius: 99px;
      border: 1px solid var(--border);
    }

    .status-indicator-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }

    .status-indicator-dot.connected {
      background: var(--success);
      box-shadow: 0 0 10px var(--success);
      animation: pulse 1.8s infinite;
    }

    .status-indicator-dot.disconnected {
      background: var(--error);
      box-shadow: 0 0 10px var(--error);
    }

    .project-badge {
      background: rgba(255, 255, 255, 0.04);
      padding: 6px 16px;
      border-radius: 99px;
      font-size: 13px;
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      background: var(--success);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--success);
      animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
      0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
      70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
      100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }

    .dashboard-body {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .sidebar {
      width: 300px;
      border-right: 1px solid var(--border);
      background: rgba(7, 8, 20, 0.4);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 28px;
      overflow-y: auto;
    }

    .sidebar-section h3 {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: var(--text-muted);
      margin-bottom: 12px;
      font-weight: 700;
    }

    .session-selector-container {
      display: flex;
      gap: 8px;
    }

    #session-select {
      flex: 1;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      padding: 8px 12px;
      font-family: inherit;
      font-size: 13.5px;
      outline: none;
      cursor: pointer;
      transition: border-color 0.2s;
    }

    #session-select:focus {
      border-color: var(--accent-primary);
    }

    .filter-pills {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .filter-pill {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      padding: 8px 12px;
      border-radius: 8px;
      text-align: left;
      cursor: pointer;
      font-family: inherit;
      font-size: 13.5px;
      transition: all 0.2s;
    }

    .filter-pill:hover {
      background: rgba(255, 255, 255, 0.03);
      color: var(--text);
    }

    .filter-pill.active {
      background: rgba(0, 242, 254, 0.08);
      border-color: rgba(0, 242, 254, 0.2);
      color: var(--accent-primary);
      font-weight: 500;
      box-shadow: inset 0 0 8px rgba(0, 242, 254, 0.05);
    }

    .btn {
      font-family: inherit;
      font-size: 13px;
      font-weight: 500;
      padding: 8px 14px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      outline: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .btn-primary {
      background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
      border: none;
      color: #070814;
      font-weight: 600;
      box-shadow: 0 4px 14px rgba(0, 242, 254, 0.2);
    }

    .btn-primary:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 18px rgba(0, 242, 254, 0.3);
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      color: var(--text);
    }

    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.15);
    }

    .btn-refresh {
      padding: 8px 10px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      color: var(--text);
    }

    .control-grid {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .toggle-container {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 4px;
      font-size: 13.5px;
      color: var(--text-muted);
    }

    .switch {
      position: relative;
      display: inline-block;
      width: 38px;
      height: 20px;
    }

    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(255, 255, 255, 0.1);
      transition: .3s;
      border-radius: 34px;
      border: 1px solid var(--border);
    }

    .slider:before {
      position: absolute;
      content: "";
      height: 12px;
      width: 12px;
      left: 3px;
      bottom: 3px;
      background-color: var(--text-muted);
      transition: .3s;
      border-radius: 50%;
    }

    input:checked + .slider {
      background-color: rgba(0, 242, 254, 0.2);
      border-color: rgba(0, 242, 254, 0.4);
    }

    input:checked + .slider:before {
      transform: translateX(18px);
      background-color: var(--accent-primary);
      box-shadow: 0 0 8px var(--accent-primary);
    }

    .flex-grow {
      flex-grow: 1;
    }

    .sidebar-section.system-mini-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border);
      padding: 14px;
      border-radius: 12px;
      font-size: 12px;
      line-height: 1.6;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .highlight-text {
      color: var(--accent-primary);
      font-weight: 500;
    }

    .model-badge {
      background: rgba(168, 85, 247, 0.1);
      border: 1px solid rgba(168, 85, 247, 0.25);
      color: #d8b4fe;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      display: inline-block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      vertical-align: middle;
    }

    .main-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      padding: 24px 32px;
      background: transparent;
    }

    .tab-header {
      display: flex;
      gap: 8px;
      padding: 6px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border);
      border-radius: 12px;
      margin-bottom: 20px;
      align-self: flex-start;
    }

    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 8px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-family: inherit;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
    }

    .tab-btn:hover {
      color: var(--text);
    }

    .tab-btn.active {
      background: rgba(255, 255, 255, 0.05);
      color: var(--accent-primary);
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .tab-content {
      display: none;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      animation: fadeIn 0.25s ease-out;
    }

    .tab-content.active {
      display: flex;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .log-search-container {
      margin-bottom: 16px;
    }

    #log-search {
      width: 100%;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      padding: 12px 18px;
      font-family: inherit;
      font-size: 14px;
      outline: none;
      transition: all 0.2s;
    }

    #log-search:focus {
      border-color: rgba(0, 242, 254, 0.3);
      background: rgba(255, 255, 255, 0.04);
      box-shadow: 0 0 14px rgba(0, 242, 254, 0.08);
    }

    .timeline-container {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding-right: 6px;
    }

    .no-events-msg, .no-diff-msg {
      text-align: center;
      padding: 48px;
      color: var(--text-muted);
      font-size: 14px;
      border: 1px dashed var(--border);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.01);
    }

    .event-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      line-height: 1.5;
      position: relative;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .event-card:hover {
      border-color: rgba(255, 255, 255, 0.12);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    }

    .event-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      font-size: 11px;
      color: var(--text-muted);
      font-family: 'Outfit', sans-serif;
    }

    .event-badge {
      padding: 3px 8px;
      border-radius: 4px;
      font-weight: 700;
      letter-spacing: 0.5px;
      font-size: 10px;
    }

    .event-time {
      font-family: 'JetBrains Mono', monospace;
    }

    .event-card.chat-user {
      align-self: center;
      background: linear-gradient(135deg, rgba(79, 172, 254, 0.06) 0%, rgba(0, 242, 254, 0.06) 100%);
      border-color: rgba(0, 242, 254, 0.15);
      width: 90%;
      margin: 8px 0;
      border-radius: 16px;
      display: flex;
      gap: 16px;
      align-items: flex-start;
      box-shadow: 0 4px 20px rgba(0, 242, 254, 0.03);
    }

    .user-avatar {
      font-size: 20px;
      background: rgba(0, 242, 254, 0.1);
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      border: 1px solid rgba(0, 242, 254, 0.2);
    }

    .user-content {
      flex: 1;
      font-family: 'Outfit', sans-serif;
      font-size: 15px;
      line-height: 1.6;
      color: var(--text);
      padding-top: 4px;
      white-space: pre-wrap;
    }

    .event-plan {
      border-left: 3px solid var(--plan);
    }

    .event-plan .event-badge {
      color: #f3e8ff;
      background: rgba(168, 85, 247, 0.2);
      border: 1px solid rgba(168, 85, 247, 0.3);
    }

    .plan-thought {
      font-style: italic;
      color: #d1d5db;
      border-left: 2px solid rgba(168, 85, 247, 0.3);
      padding-left: 12px;
      margin-bottom: 12px;
      font-size: 13.5px;
      line-height: 1.6;
    }

    .plan-summary {
      font-family: 'Outfit', sans-serif;
      font-size: 14.5px;
      margin-bottom: 10px;
      color: #e5e7eb;
    }

    .plan-tool-call {
      font-size: 12.5px;
      color: var(--text-muted);
    }

    .tool-badge {
      background: rgba(0, 242, 254, 0.06);
      border: 1px solid rgba(0, 242, 254, 0.2);
      color: var(--accent-primary);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11.5px;
      font-family: 'JetBrains Mono', monospace;
      font-weight: 500;
    }

    .event-execution {
      border-left: 3px solid var(--success);
    }

    .event-execution.failed {
      border-left-color: var(--error);
    }

    .event-execution .event-badge {
      color: #ecfdf5;
      background: rgba(16, 185, 129, 0.2);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .event-execution.failed .event-badge {
      color: #fff1f2;
      background: rgba(244, 63, 94, 0.2);
      border: 1px solid rgba(244, 63, 94, 0.3);
    }

    .exec-tool-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .exec-tool-name {
      font-size: 14px;
      font-weight: 600;
    }

    .status-indicator {
      font-family: 'Outfit', sans-serif;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.5px;
      padding: 3px 8px;
      border-radius: 4px;
    }

    .status-success {
      background: rgba(16, 185, 129, 0.1);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.2);
    }

    .status-failed {
      background: rgba(244, 63, 94, 0.1);
      color: var(--error);
      border: 1px solid rgba(244, 63, 94, 0.2);
    }

    .collapsible-args, .collapsible-result {
      margin-top: 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.04);
      padding-top: 10px;
    }

    .collapsible-trigger {
      font-family: 'Outfit', sans-serif;
      font-size: 12px;
      color: var(--text-muted);
      cursor: pointer;
      user-select: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: color 0.2s;
    }

    .collapsible-trigger:hover {
      color: var(--text);
    }

    .collapsible-content {
      display: none;
      max-height: 350px;
      overflow-y: auto;
      background: rgba(0, 0, 0, 0.25);
      padding: 12px;
      border-radius: 8px;
      margin-top: 6px;
      border: 1px solid rgba(255, 255, 255, 0.03);
      white-space: pre-wrap;
      color: #e5e7eb;
      font-size: 12.5px;
    }

    .collapsible-content.active {
      display: block;
    }

    .event-interception {
      border-left: 3px solid var(--warning);
    }

    .event-interception .event-badge {
      color: #fffbeb;
      background: rgba(245, 158, 11, 0.2);
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .interception-banner {
      background: repeating-linear-gradient(45deg, rgba(245, 158, 11, 0.08), rgba(245, 158, 11, 0.08) 10px, rgba(245, 158, 11, 0.15) 10px, rgba(245, 158, 11, 0.15) 20px);
      padding: 8px;
      border-radius: 8px;
      font-weight: 700;
      color: var(--warning);
      text-align: center;
      margin-bottom: 12px;
      font-family: 'Outfit', sans-serif;
      font-size: 12px;
      letter-spacing: 1px;
      border: 1px dashed rgba(245, 158, 11, 0.3);
    }

    .interception-advice {
      font-family: 'Outfit', sans-serif;
      color: #e5e7eb;
      margin-bottom: 6px;
      font-size: 14px;
    }

    .interception-reason {
      font-family: 'Outfit', sans-serif;
      font-size: 13.5px;
      color: var(--text-muted);
    }

    .event-card.observe-card {
      align-self: center;
      padding: 8px 20px;
      background: rgba(255, 255, 255, 0.015);
      border-color: rgba(255, 255, 255, 0.03);
      border-radius: 24px;
      font-size: 12px;
      box-shadow: none;
    }

    .observe-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text-muted);
      font-family: 'Outfit', sans-serif;
    }

    .pulse-dot-small {
      width: 6px;
      height: 6px;
      background: var(--accent-secondary);
      border-radius: 50%;
      box-shadow: 0 0 6px var(--accent-secondary);
      animation: pulse-small 1.5s infinite;
    }

    @keyframes pulse-small {
      0% { transform: scale(0.9); box-shadow: 0 0 0 0 rgba(79, 172, 254, 0.7); }
      70% { transform: scale(1.1); box-shadow: 0 0 0 4px rgba(79, 172, 254, 0); }
      100% { transform: scale(0.9); box-shadow: 0 0 0 0 rgba(79, 172, 254, 0); }
    }

    .diff-actions {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
    }

    .diff-container {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding-right: 6px;
    }

    .diff-file-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      transition: all 0.3s;
    }

    .diff-file-header {
      padding: 14px 20px;
      background: rgba(255, 255, 255, 0.02);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      user-select: none;
    }

    .diff-file-header .arrow {
      font-size: 10px;
      color: var(--text-muted);
      transition: transform 0.2s;
    }

    .diff-file-card.collapsed .diff-file-header .arrow {
      transform: rotate(-90deg);
    }

    .diff-file-card.collapsed .diff-file-body {
      display: none;
    }

    .diff-file-header .file-name {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13.5px;
      font-weight: 500;
      flex: 1;
      color: #e5e7eb;
    }

    .file-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
    }

    .file-badge.del {
      background: rgba(244, 63, 94, 0.15);
      color: #fb7185;
    }

    .diff-file-body {
      padding: 16px;
      overflow-x: auto;
      background: rgba(0, 0, 0, 0.15);
    }

    .diff-code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      line-height: 1.6;
    }

    .diff-line {
      display: block;
      padding: 1px 8px;
      border-radius: 2px;
      white-space: pre;
    }

    .diff-line.add {
      background: rgba(16, 185, 129, 0.08);
      color: #34d399;
      border-left: 2px solid #10b981;
    }

    .diff-line.del {
      background: rgba(244, 63, 94, 0.08);
      color: #fb7185;
      border-left: 2px solid #f43f5e;
    }

    .diff-line.meta {
      color: #a78bfa;
      font-weight: 500;
      background: rgba(139, 92, 246, 0.04);
    }

    .status-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 24px;
      overflow-y: auto;
      padding-right: 6px;
    }

    .status-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    }

    .status-card h3 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 20px;
      color: var(--accent-primary);
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
    }

    .status-card-body {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .status-item {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      font-size: 14px;
      gap: 16px;
    }

    .status-item .label {
      color: var(--text-muted);
      font-weight: 500;
    }

    .status-item .val {
      color: var(--text);
      font-weight: 600;
      text-align: right;
      word-break: break-all;
    }

    .status-item .val.path-text {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #cbd5e1;
    }

    .svg-defs {
      position: absolute;
      width: 0;
      height: 0;
    }
  </style>
</head>
<body>
  <svg class="svg-defs">
    <defs>
      <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#00f2fe" />
        <stop offset="100%" stop-color="#4facfe" />
      </linearGradient>
    </defs>
  </svg>

  <header>
    <div class="header-logo">
      <svg class="logo-icon" viewBox="0 0 24 24">
        <path d="M12 2L2 22h20L12 2zm0 3.99L19.53 19H4.47L12 5.99zM11 16h2v2h-2v-2zm0-6h2v4h-2v-4z" />
      </svg>
      <span>AURA OS</span>
    </div>
    <div class="connection-status">
      <span class="status-indicator-dot disconnected" id="connection-dot"></span>
      <span id="connection-text">Connecting...</span>
    </div>
    <div class="project-badge">
      <div class="pulse-dot"></div>
      <span>Workspace: <strong id="workspace-name">-</strong></span>
    </div>
  </header>

  <div class="dashboard-body">
    <aside class="sidebar">
      <div class="sidebar-section">
        <h3>Active Session</h3>
        <div class="session-selector-container">
          <select id="session-select" onchange="loadSessionEvents()">
            <option value="">Live Stream</option>
          </select>
          <button class="btn btn-refresh" onclick="loadSessions()" title="Refresh sessions">🔄</button>
        </div>
      </div>

      <div class="sidebar-section">
        <h3>Log Filters</h3>
        <div class="filter-pills">
          <button class="filter-pill active" data-filter="all" onclick="setFilter('all')">All Events</button>
          <button class="filter-pill" data-filter="user" onclick="setFilter('user')">User Messages</button>
          <button class="filter-pill" data-filter="plan" onclick="setFilter('plan')">Agent Plans</button>
          <button class="filter-pill" data-filter="execution" onclick="setFilter('execution')">Tool Executions</button>
          <button class="filter-pill" data-filter="interception" onclick="setFilter('interception')">Interceptions</button>
        </div>
      </div>

      <div class="sidebar-section flex-grow">
        <h3>Controls</h3>
        <div class="control-grid">
          <button class="btn btn-secondary" onclick="clearConsole()">🧹 Clear View</button>
          <button class="btn btn-secondary" onclick="fetchDiff()">🔄 Refresh Diff</button>
          <button class="btn btn-secondary" onclick="exportLogs()">📥 Export Logs</button>
          <div class="toggle-container">
            <span>Auto-Scroll</span>
            <label class="switch">
              <input type="checkbox" id="autoscroll-toggle" checked>
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </div>

      <div class="sidebar-section system-mini-card">
        <div>Database: <span id="db-session-name" class="highlight-text">-</span></div>
        <div>LLM Model: <span id="sidebar-model-badge" class="model-badge">-</span></div>
      </div>
    </aside>

    <main class="main-content">
      <div class="tab-header">
        <button class="tab-btn active" id="btn-tab-logs" onclick="switchTab('tab-logs')">Timeline & Logs</button>
        <button class="tab-btn" id="btn-tab-diff" onclick="switchTab('tab-diff')">Workspace Diff</button>
        <button class="tab-btn" id="btn-tab-status" onclick="switchTab('tab-status')">System Status</button>
      </div>

      <div class="tab-content active" id="tab-logs">
        <div class="log-search-container">
          <input type="text" id="log-search" placeholder="Search event logs (text, tools, thoughts...)" oninput="filterSearch()">
        </div>
        <div class="timeline-container" id="timeline">
          <div class="no-events-msg">Waiting for events to stream...</div>
        </div>
      </div>

      <div class="tab-content" id="tab-diff">
        <div class="diff-actions">
          <button class="btn btn-primary" onclick="fetchDiff()">Refresh Git Diff</button>
          <button class="btn btn-secondary" onclick="copyWholeDiff()">Copy Diff</button>
        </div>
        <div class="diff-container" id="diff-files-container">
          <div class="no-diff-msg">Loading shadow workspace diffs...</div>
        </div>
      </div>

      <div class="tab-content" id="tab-status">
        <div class="status-grid">
          <div class="status-card">
            <h3>Workspace Directory</h3>
            <div class="status-card-body">
              <div class="status-item">
                <span class="label">Project Name:</span>
                <span class="val" id="stat-project-name">-</span>
              </div>
              <div class="status-item">
                <span class="label">Project Path:</span>
                <span class="val path-text" id="stat-project-path">-</span>
              </div>
              <div class="status-item">
                <span class="label">Active Session:</span>
                <span class="val" id="stat-session-name">-</span>
              </div>
              <div class="status-item">
                <span class="label">Database Size:</span>
                <span class="val" id="stat-db-size">-</span>
              </div>
            </div>
          </div>

          <div class="status-card">
            <h3>LLM Parameters</h3>
            <div class="status-card-body">
              <div class="status-item">
                <span class="label">LLM Provider:</span>
                <span class="val" id="stat-provider">-</span>
              </div>
              <div class="status-item">
                <span class="label">Model ID:</span>
                <span class="val model-badge" id="stat-model">-</span>
              </div>
              <div class="status-item">
                <span class="label">Temperature:</span>
                <span class="val" id="stat-temp">-</span>
              </div>
            </div>
          </div>

          <div class="status-card">
            <h3>OS Environment</h3>
            <div class="status-card-body">
              <div class="status-item">
                <span class="label">Total Events Logged:</span>
                <span class="val" id="stat-total-events">-</span>
              </div>
              <div class="status-item">
                <span class="label">Total Sessions:</span>
                <span class="val" id="stat-total-sessions">-</span>
              </div>
              <div class="status-item">
                <span class="label">Aura CLI Version:</span>
                <span class="val" id="stat-aura-version">-</span>
              </div>
              <div class="status-item">
                <span class="label">Node.js Engine:</span>
                <span class="val" id="stat-ruby-version">-</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <script>
    let allEvents = [];
    let activeFilter = 'all';
    let currentRawDiff = '';
    let eventSource = null;

    function escapeHTML(str) {
      if (typeof str !== 'string') return String(str || '');
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function formatBytes(bytes) {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    window.addEventListener('DOMContentLoaded', () => {
      fetchStatus();
      loadSessions();
      startSSESubscription();
      fetchDiff();
    });

    function fetchStatus() {
      fetch('/api/status')
        .then(res => res.json())
        .then(data => {
          if (data.error) return;
          document.getElementById('workspace-name').textContent = data.project_name || 'Aura Project';
          document.getElementById('db-session-name').textContent = data.session_name || 'default';
          document.getElementById('sidebar-model-badge').textContent = data.model || 'Unknown';
          document.getElementById('sidebar-model-badge').title = data.model || '';

          document.getElementById('stat-project-name').textContent = data.project_name || '-';
          document.getElementById('stat-project-path').textContent = data.project_path || '-';
          document.getElementById('stat-session-name').textContent = data.session_name || '-';
          document.getElementById('stat-db-size').textContent = formatBytes(data.db_size) || '-';
          document.getElementById('stat-provider').textContent = data.provider || '-';
          document.getElementById('stat-model').textContent = data.model || '-';
          document.getElementById('stat-temp').textContent = data.temperature !== undefined ? data.temperature : '-';
          document.getElementById('stat-total-events').textContent = data.total_events || '0';
          document.getElementById('stat-total-sessions').textContent = data.total_sessions || '0';
          document.getElementById('stat-aura-version').textContent = data.version || '-';
          document.getElementById('stat-ruby-version').textContent = data.node_version || '-';
        })
        .catch(err => console.error('Error loading system status:', err));
    }

    function loadSessions() {
      const sessionSelect = document.getElementById('session-select');
      fetch('/api/sessions')
        .then(res => res.json())
        .then(data => {
          const currentVal = sessionSelect.value;
          sessionSelect.innerHTML = '<option value="">Live Stream</option>';
          
          if (data.sessions && Array.isArray(data.sessions)) {
            data.sessions.forEach(id => {
              const option = document.createElement('option');
              option.value = id;
              option.textContent = 'Phase: ' + id;
              sessionSelect.appendChild(option);
            });
          }
          sessionSelect.value = currentVal;
        })
        .catch(err => console.error('Error loading sessions:', err));
    }

    function loadSessionEvents() {
      const sessionSelect = document.getElementById('session-select');
      const sessionId = sessionSelect.value;
      const timeline = document.getElementById('timeline');
      
      if (!sessionId) {
        clearConsole();
        timeline.innerHTML = '<div class="no-events-msg">Re-establishing live stream...</div>';
        startSSESubscription();
        return;
      }

      stopSSESubscription();
      updateConnectionState(false, 'Filtered View');

      timeline.innerHTML = '<div class="no-events-msg">Loading session logs...</div>';
      allEvents = [];

      fetch('/api/sessions/' + sessionId)
        .then(res => res.json())
        .then(data => {
          timeline.innerHTML = '';
          if (data.events && Array.isArray(data.events)) {
            data.events.forEach(evt => {
              let parsedEvt = evt;
              if (typeof evt === 'string') {
                try {
                  parsedEvt = JSON.parse(evt);
                } catch (e) {
                  parsedEvt = { phase: 'system', message: evt };
                }
              }
              allEvents.push(parsedEvt);
            });
          }
          renderAllEvents();
        })
        .catch(err => {
          timeline.innerHTML = '<div class="no-events-msg">Error loading events: ' + escapeHTML(err.message) + '</div>';
        });
    }

    function startSSESubscription() {
      if (eventSource) {
        eventSource.close();
      }

      updateConnectionState(false, 'Connecting...');
      eventSource = new EventSource('/sse');
      
      eventSource.onopen = () => {
        updateConnectionState(true, 'Streaming Logs');
        const timeline = document.getElementById('timeline');
        if (allEvents.length === 0) {
          timeline.innerHTML = '';
        }
      };

      eventSource.onmessage = (e) => {
        const sessionSelect = document.getElementById('session-select');
        if (sessionSelect.value !== '') return;

        const data = e.data;
        let parsedEvt = null;

        try {
          parsedEvt = JSON.parse(data);
        } catch (err) {
          parsedEvt = { phase: 'system', message: data };
        }

        addEvent(parsedEvt);
        fetchStatus();
      };

      eventSource.onerror = (err) => {
        updateConnectionState(false, 'Disconnected');
      };
    }

    function stopSSESubscription() {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    }

    function updateConnectionState(isConnected, text) {
      const dot = document.getElementById('connection-dot');
      const lbl = document.getElementById('connection-text');
      
      if (isConnected) {
        dot.className = 'status-indicator-dot connected';
      } else {
        dot.className = 'status-indicator-dot disconnected';
      }
      lbl.textContent = text;
    }

    function switchTab(tabId) {
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.id === \`btn-\${tabId}\`);
      });

      document.querySelectorAll('.tab-content').forEach(pane => {
        pane.classList.toggle('active', pane.id === tabId);
      });

      if (tabId === 'tab-diff') {
        fetchDiff();
      } else if (tabId === 'tab-status') {
        fetchStatus();
      }
    }

    function setFilter(filterType) {
      activeFilter = filterType;
      document.querySelectorAll('.filter-pills .filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === filterType);
      });
      renderAllEvents();
    }

    function filterSearch() {
      renderAllEvents();
    }

    function matchesFilterAndSearch(evt) {
      if (activeFilter !== 'all') {
        if (evt.phase !== activeFilter) return false;
      }

      const searchText = document.getElementById('log-search').value.toLowerCase().trim();
      if (searchText === '') return true;

      const content = (evt.content || '').toLowerCase();
      const thought = (evt.thought || '').toLowerCase();
      const summary = (evt.summary || '').toLowerCase();
      const tool = (evt.tool || '').toLowerCase();
      const message = (evt.message || '').toLowerCase();
      const output = evt.result ? (evt.result.output || evt.result.error || JSON.stringify(evt.result)).toLowerCase() : '';

      return content.includes(searchText) ||
             thought.includes(searchText) ||
             summary.includes(searchText) ||
             tool.includes(searchText) ||
             message.includes(searchText) ||
             output.includes(searchText);
    }

    function addEvent(evt) {
      allEvents.push(evt);

      if (matchesFilterAndSearch(evt)) {
        const timeline = document.getElementById('timeline');
        const noEventsMsg = timeline.querySelector('.no-events-msg');
        if (noEventsMsg) {
          timeline.innerHTML = '';
        }

        const card = renderEventCard(evt);
        timeline.appendChild(card);
        
        if (document.getElementById('autoscroll-toggle').checked) {
          timeline.scrollTop = timeline.scrollHeight;
        }
      }
    }

    function renderAllEvents() {
      const timeline = document.getElementById('timeline');
      timeline.innerHTML = '';

      const filtered = allEvents.filter(matchesFilterAndSearch);

      if (filtered.length === 0) {
        timeline.innerHTML = '<div class="no-events-msg">No logs matching active search and filters.</div>';
        return;
      }

      filtered.forEach(evt => {
        const card = renderEventCard(evt);
        timeline.appendChild(card);
      });

      if (document.getElementById('autoscroll-toggle').checked) {
        timeline.scrollTop = timeline.scrollHeight;
      }
    }

    function renderEventCard(evt) {
      const card = document.createElement('div');
      card.className = \`event-card event-\${evt.phase || 'custom'}\`;

      const time = evt.timestamp ? new Date(evt.timestamp * 1000).toLocaleTimeString() : new Date().toLocaleTimeString();

      const headerHTML = \`
        <div class="event-header">
          <span class="event-badge">\${escapeHTML(evt.phase ? evt.phase.toUpperCase() : 'SYSTEM')}</span>
          <span class="event-time">\${time}</span>
        </div>
      \`;

      if (evt.phase === 'user') {
        card.classList.add('chat-user');
        card.innerHTML = \`
          <div class="user-avatar">👤</div>
          <div class="user-content">\${escapeHTML(evt.content || evt.message || '')}</div>
        \`;
        return card;
      }

      if (evt.phase === 'plan') {
        card.innerHTML = \`
          \${headerHTML}
          <div class="plan-summary"><strong>Planned Action:</strong> \${escapeHTML(evt.summary || '')}</div>
          \${evt.thought ? \`<div class="plan-thought">"\${escapeHTML(evt.thought)}"</div>\` : ''}
          \${evt.tool ? \`<div class="plan-tool-call">Tool to execute: <span class="tool-badge">\${escapeHTML(evt.tool)}</span></div>\` : ''}
          \${evt.args && Object.keys(evt.args).length ? \`
            <div class="collapsible-args">
              <div class="collapsible-trigger" onclick="toggleDetails(this)">▶ View Arguments</div>
              <pre class="collapsible-content"><code>\${escapeHTML(JSON.stringify(evt.args, null, 2))}</code></pre>
            </div>
          \` : ''}
        \`;
        return card;
      }

      if (evt.phase === 'execution') {
        const isSuccess = evt.result && evt.result.status !== 'failed';
        const statusClass = isSuccess ? 'status-success' : 'status-failed';
        const statusText = isSuccess ? 'SUCCESS' : 'FAILED';
        const output = evt.result ? (evt.result.output || evt.result.error || JSON.stringify(evt.result)) : '';

        card.innerHTML = \`
          \${headerHTML}
          <div class="exec-tool-header">
            <span class="tool-badge exec-tool-name">\${escapeHTML(evt.tool || '')}</span>
            <span class="status-indicator \${statusClass}">\${statusText}</span>
          </div>
          <div class="collapsible-result">
            <div class="collapsible-trigger" onclick="toggleDetails(this)">▼ View Results</div>
            <pre class="collapsible-content active"><code>\${escapeHTML(output)}</code></pre>
          </div>
        \`;
        
        if (!isSuccess) {
          card.classList.add('failed');
        }
        return card;
      }

      if (evt.phase === 'interception') {
        card.innerHTML = \`
          \${headerHTML}
          <div class="interception-banner">⚠️ AGENT ACTION INTERCEPTED</div>
          <div class="interception-advice"><strong>Guidance:</strong> \${escapeHTML(evt.advice || '')}</div>
          \${evt.reason ? \`<div class="interception-reason"><strong>Reason:</strong> \${escapeHTML(evt.reason)}</div>\` : ''}
        \`;
        return card;
      }

      if (evt.phase === 'observe') {
        card.classList.add('observe-card');
        card.innerHTML = \`
          <div class="observe-pill">
            <span class="pulse-dot-small"></span> Observing workspace changes...
          </div>
        \`;
        return card;
      }

      const bodyMsg = evt.message || evt.content || (typeof evt === 'object' ? JSON.stringify(evt, null, 2) : String(evt));
      card.innerHTML = \`
        \${headerHTML}
        <div style="white-space: pre-wrap; font-size: 12.5px; color: #cbd5e1;">\${escapeHTML(bodyMsg)}</div>
      \`;
      return card;
    }

    function toggleDetails(triggerElement) {
      const content = triggerElement.nextElementSibling;
      content.classList.toggle('active');
      const isActive = content.classList.contains('active');
      triggerElement.textContent = (isActive ? '▼' : '▶') + triggerElement.textContent.substring(1);
    }

    function clearConsole() {
      allEvents = [];
      renderAllEvents();
    }

    function fetchDiff() {
      const container = document.getElementById('diff-files-container');
      container.innerHTML = '<div class="no-events-msg"><span class="pulse-dot-small"></span> Running shadow git diff...</div>';

      fetch('/diff')
        .then(res => res.json())
        .then(data => {
          container.innerHTML = '';
          currentRawDiff = data.diff || '';

          if (!data.diff || data.diff.trim() === '' || data.diff.includes('No changes recorded')) {
            container.innerHTML = '<div class="no-diff-msg">No unstaged changes recorded in the shadow workspace.</div>';
            return;
          }

          const files = [];
          let currentFile = null;
          const lines = data.diff.split('\\n');

          lines.forEach(line => {
            if (line.startsWith('diff --git ')) {
              const match = line.match(/b\\/(.+)$/);
              const filename = match ? match[1] : 'Unknown File';
              currentFile = {
                name: filename,
                lines: []
              };
              files.push(currentFile);
            } else if (currentFile) {
              currentFile.lines.push(line);
            }
          });

          if (files.length === 0) {
            const rawCard = document.createElement('div');
            rawCard.className = 'diff-file-card';
            rawCard.innerHTML = \`
              <div class="diff-file-header" onclick="toggleDiffCard(this)">
                <span class="arrow">▼</span>
                <span class="file-name">Raw Diff Logs</span>
              </div>
              <div class="diff-file-body">
                <pre class="diff-code"><code>\${formatDiffLines(lines)}</code></pre>
              </div>
            \`;
            container.appendChild(rawCard);
            return;
          }

          files.forEach(file => {
            const fileCard = document.createElement('div');
            fileCard.className = 'diff-file-card';
            
            const adds = file.lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
            const dels = file.lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;

            fileCard.innerHTML = \`
              <div class="diff-file-header" onclick="toggleDiffCard(this)">
                <span class="arrow">▼</span>
                <span class="file-name">\${escapeHTML(file.name)}</span>
                \${adds > 0 ? \`<span class="file-badge">+\${adds}</span>\` : ''}
                \${dels > 0 ? \`<span class="file-badge del">-\${dels}</span>\` : ''}
              </div>
              <div class="diff-file-body">
                <pre class="diff-code"><code>\${formatDiffLines(file.lines)}</code></pre>
              </div>
            \`;
            container.appendChild(fileCard);
          });
        })
        .catch(err => {
          container.innerHTML = \`<div class="no-diff-msg">Error loading workspace diff: \${escapeHTML(err.message)}</div>\`;
        });
    }

    function formatDiffLines(lines) {
      return lines.map(line => {
        let cls = '';
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'add';
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'del';
        else if (line.startsWith('@@') || line.startsWith('diff') || line.startsWith('index') || line.startsWith('---') || line.startsWith('+++')) cls = 'meta';

        return \`<div class="diff-line \${cls}">\${escapeHTML(line)}</div>\`;
      }).join('');
    }

    function toggleDiffCard(header) {
      const card = header.parentElement;
      card.classList.toggle('collapsed');
    }

    function copyWholeDiff() {
      if (!currentRawDiff) {
        alert('No diff content to copy!');
        return;
      }
      navigator.clipboard.writeText(currentRawDiff)
        .then(() => alert('Git diff copied to clipboard!'))
        .catch(err => alert('Failed to copy diff: ' + err.message));
    }

    function exportLogs() {
      if (allEvents.length === 0) {
        alert('No logs recorded to export!');
        return;
      }
      const text = JSON.stringify(allEvents, null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = \`aura-session-logs-\${Date.now()}.json\`;
      document.body.appendChild(a);
      a.click();
      
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  </script>
</body>
</html>`;
  }
}

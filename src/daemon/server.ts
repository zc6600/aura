import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Bridge } from '../core/interface/bridge.js';
import { RalphLoop } from '../core/kernel/ralphLoop.js';
import { Runner } from '../core/kernel/runner.js';
import { resolveIpcPath } from './ipc.js';
import Database from 'better-sqlite3';
import yaml from 'yaml';
import { SessionManager } from '../core/memory/sessionManager.js';
import * as PathResolver from '../utils/pathResolver.js';
import { SQLiteStore } from '../core/memory/sqliteStore.js';
import { HintProvider } from '../core/context/providers/hintProvider.js';

/**
 * DaemonServer acts as the local persistent engine for Aura OS.
 * It manages workspace lifecycle, runs agentic loops, and streams notifications.
 */
export class DaemonServer {
  private server: net.Server | null = null;
  private projectPath: string;
  private socketPath: string;
  private runner: Runner | null = null;
  private activeLoopJob: {
    status: 'running' | 'idle';
    goal?: string;
    mode?: string;
  } = { status: 'idle' };
  private connections = new Set<net.Socket>();
  private idleTimer: NodeJS.Timeout | null = null;
  private pendingClientRequests = new Map<string, (result: unknown) => void>();
  private static readonly IDLE_TIMEOUT_MS = 600000; // 10 minutes

  constructor(projectPath: string) {
    this.projectPath = path.resolve(projectPath);
    this.socketPath = resolveIpcPath(this.projectPath);
  }

  public async start(): Promise<void> {
    if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {}
    }

    this.server = net.createServer((socket) => {
      this.connections.add(socket);
      this.resetIdleTimer();

      let buffer = '';
      socket.on('data', (data) => {
        buffer += data.toString();
        let idx = buffer.indexOf('\n');
        while (idx !== -1) {
          const line = buffer.substring(0, idx).trim();
          buffer = buffer.substring(idx + 1);
          if (line) {
            this.handleMessage(socket, line);
          }
          idx = buffer.indexOf('\n');
        }
      });

      socket.on('close', () => {
        this.connections.delete(socket);
        this.resetIdleTimer();
      });

      socket.on('error', () => {
        this.connections.delete(socket);
        this.resetIdleTimer();
      });
    });

    return new Promise((resolve, reject) => {
      this.server?.listen(this.socketPath, () => {
        console.log(`Aura Daemon listening on IPC path: ${this.socketPath}`);
        this.resetIdleTimer();
        resolve();
      });

      this.server?.on('error', (err) => {
        reject(err);
      });
    });
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    if (this.connections.size === 0 && this.activeLoopJob.status === 'idle') {
      this.idleTimer = setTimeout(() => {
        console.log(
          'Aura Daemon shutting down due to inactivity (idle timeout)...',
        );
        this.stop();
      }, DaemonServer.IDLE_TIMEOUT_MS);
    }
  }

  public stop(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();
    if (this.server) {
      this.server.close();
    }
    if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {}
    }
  }

  private handleMessage(socket: net.Socket, line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch (err: unknown) {
      const msg = (err as Error).message ?? String(err);
      this.sendError(socket, null, -32700, `Parse error: ${msg}`);
      return;
    }

    const { method, params, id, result, error } = msg;

    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
      this.sendError(socket, msg && msg.id !== undefined ? msg.id : null, -32600, 'Invalid Request');
      return;
    }

    if (typeof id === 'string') {
      const resolveFn = this.pendingClientRequests.get(id);
      if (resolveFn) {
        this.pendingClientRequests.delete(id);
        resolveFn(result !== undefined ? result : error);
        return;
      }
    }

    this.dispatch(socket, id as unknown, method as string, params as unknown);
  }

  private async dispatch(
    socket: net.Socket,
    id: unknown,
    method: string,
    params: unknown,
  ): Promise<void> {
    try {
      switch (method) {
        case 'workspace/initialize': {
          const p = params as Record<string, unknown> | null | undefined;
          const { sessionName } = p || {};
          this.runner = new Runner(this.projectPath);
          if (sessionName) {
            this.runner.reconnectSession(sessionName as string);
          }
          this.sendResult(socket, id, {
            initialized: true,
            projectPath: this.projectPath,
            sessionName: this.runner.sessionName,
          });
          break;
        }

        case 'agent/runGoal': {
          if (!this.runner) {
            this.runner = new Runner(this.projectPath);
          }
          if (this.activeLoopJob.status === 'running') {
            this.sendError(
              socket,
              id,
              -32603,
              'Daemon is already running a goal loop.',
            );
            return;
          }

          const p = params as Record<string, unknown> | null | undefined;
          const { goal, mode, options } = p || {};
          if (!goal || typeof goal !== 'string') {
            this.sendError(socket, id, -32602, 'Invalid goal parameter.');
            return;
          }

          this.activeLoopJob = {
            status: 'running',
            goal,
            mode: mode as string | undefined,
          };
          if (this.idleTimer) clearTimeout(this.idleTimer);

          const eventBus = {
            emit: (ev: string, data?: unknown) => {
              this.sendNotification('agent/onProgress', {
                type: ev,
                payload: data,
              });
            },
          };

          try {
            if (mode === 'ralph') {
              const ralph = new RalphLoop(this.runner, goal, {
                ...((options as Record<string, unknown>) || {}),
                eventBus,
              });
              const status = await ralph.run();
              this.sendResult(socket, id, { status });
            } else {
              const bridge = new Bridge(this.projectPath, {
                runner: this.runner,
              });

              let final_content: string | undefined;
              let status: 'completed' | 'failed' = 'completed';

              bridge.on('on_final_answer', (content: string) => {
                final_content = content;
              });
              bridge.on(
                'on_waiting',
                (startTimeMs: number, _streamedCheck: () => boolean) => {
                  this.sendNotification('agent/onProgress', {
                    type: 'waiting',
                    payload: { elapsed: (Date.now() - startTimeMs) / 1000 },
                  });
                },
              );
              bridge.on('on_clear_waiting', () => {
                this.sendNotification('agent/onProgress', {
                  type: 'clear_waiting',
                  payload: {},
                });
              });
              bridge.on('on_token', (token: string) => {
                this.sendNotification('agent/onProgress', {
                  type: 'token',
                  payload: { text: token },
                });
              });
              bridge.on('on_stream_end', () => {
                this.sendNotification('agent/onProgress', {
                  type: 'stream_end',
                  payload: {},
                });
              });
              bridge.on(
                'on_tool_start',
                (tool: string, summary?: string | null, args?: unknown) => {
                  this.sendNotification('agent/onProgress', {
                    type: 'tool_start',
                    payload: { tool, summary, args },
                  });
                },
              );
              bridge.on('on_tool_executing', () => {
                this.sendNotification('agent/onProgress', {
                  type: 'tool_executing',
                  payload: {},
                });
              });
              bridge.on('on_tool_result', (result: unknown) => {
                console.log('Daemon on_tool_result:', JSON.stringify(result));
                this.sendNotification('agent/onProgress', {
                  type: 'tool_result',
                  payload: { result },
                });
              });
              bridge.on('on_warning', (msg: string) => {
                this.sendNotification('agent/onProgress', {
                  type: 'warning',
                  payload: { message: msg },
                });
              });
              bridge.on('on_error', (msg: string) => {
                this.sendNotification('agent/onProgress', {
                  type: 'error',
                  payload: { message: msg },
                });
                status = 'failed';
              });
              bridge.on(
                'on_thought',
                (thought: string, elapsed?: number | null) => {
                  this.sendNotification('agent/onProgress', {
                    type: 'thought',
                    payload: { content: thought, duration: elapsed },
                  });
                },
              );

              const optionsRecord = (options as Record<string, unknown>) || {};
              const isAuto =
                optionsRecord.auto_mode !== undefined
                  ? optionsRecord.auto_mode
                  : true;

              const confirmHook = async (tool: unknown, _args: unknown) => {
                const config = bridge.runner.loadConfig();
                const security = config?.security as Record<string, unknown> | undefined;
                const confirmEnabled = security?.confirm_dangerous_tools === true;

                if (!confirmEnabled) {
                  return true;
                }

                const isAutoJob =
                  bridge.runner.currentJob?.metadata?.auto_mode || false;
                if (isAutoJob) {
                  return true;
                }
                const dangerousTools = ['write_file', 'bash_command'];
                if (dangerousTools.includes(String(tool))) {
                  return await this.askClientConfirmation(
                    socket,
                    `DANGEROUS TOOL: ${tool}. Execute?`,
                  );
                }
                return true;
              };

              bridge.runner.hooks.register(
                'before_tool_execution',
                confirmHook,
              );

              try {
                await bridge.chat(goal, { auto_mode: isAuto as boolean });
              } catch (_err: unknown) {
                status = 'failed';
              } finally {
                bridge.runner.hooks.unregister(
                  'before_tool_execution',
                  confirmHook,
                );
              }

              this.sendResult(socket, id, { status, final_content });
            }
          } finally {
            this.activeLoopJob = { status: 'idle' };
            this.resetIdleTimer();
          }
          break;
        }

        case 'session/list': {
          const sessionMgr = new SessionManager(this.projectPath);
          const list = sessionMgr.list();
          this.sendResult(socket, id, { sessions: list });
          break;
        }

        case 'session/create': {
          const p = params as Record<string, unknown> | null | undefined;
          const name = p?.name;
          if (!name || typeof name !== 'string') {
            this.sendError(socket, id, -32602, 'Invalid session name.');
            return;
          }
          const sessionMgr = new SessionManager(this.projectPath);
          const session = sessionMgr.create(name, p);
          this.sendResult(socket, id, { session });
          break;
        }

        case 'session/activate': {
          const p = params as Record<string, unknown> | null | undefined;
          const name = p?.name;
          if (!name || typeof name !== 'string') {
            this.sendError(socket, id, -32602, 'Invalid session name.');
            return;
          }
          const sessionMgr = new SessionManager(this.projectPath);
          sessionMgr.activate(name);
          if (this.runner) {
            this.runner.reconnectSession(name);
          }
          this.sendResult(socket, id, { activeSession: name });
          break;
        }

        case 'session/delete': {
          const p = params as Record<string, unknown> | null | undefined;
          const name = p?.name;
          if (!name || typeof name !== 'string') {
            this.sendError(socket, id, -32602, 'Invalid session name.');
            return;
          }
          const sessionMgr = new SessionManager(this.projectPath);
          const activeSession = this.runner ? this.runner.sessionName : (sessionMgr.currentName() || 'default');
          if (name === activeSession) {
            this.sendError(socket, id, -32602, `Cannot delete the active session: ${name}`);
            return;
          }
          const success = sessionMgr.delete(name);
          this.sendResult(socket, id, { success });
          break;
        }

        case 'session/rename': {
          const p = params as Record<string, unknown> | null | undefined;
          const oldName = p?.oldName;
          const newName = p?.newName;
          if (!oldName || typeof oldName !== 'string' || !newName || typeof newName !== 'string') {
            this.sendError(socket, id, -32602, 'Invalid session names.');
            return;
          }
          const sessionMgr = new SessionManager(this.projectPath);
          const session = sessionMgr.rename(oldName, newName);
          if (this.runner && this.runner.sessionName === oldName) {
            this.runner.reconnectSession(newName);
          }
          this.sendResult(socket, id, { session });
          break;
        }

        case 'session/duplicate': {
          const p = params as Record<string, unknown> | null | undefined;
          const sourceName = p?.sourceName;
          const newName = p?.newName;
          if (!sourceName || typeof sourceName !== 'string' || !newName || typeof newName !== 'string') {
            this.sendError(socket, id, -32602, 'Invalid session names.');
            return;
          }
          const sessionMgr = new SessionManager(this.projectPath);
          const session = sessionMgr.duplicate(sourceName, newName);
          this.sendResult(socket, id, { session });
          break;
        }

        case 'workspace/writeFile': {
          const p = params as Record<string, unknown> | null | undefined;
          const filePath = p?.path;
          const content = p?.content;
          if (typeof filePath !== 'string' || typeof content !== 'string') {
            this.sendError(socket, id, -32602, 'Invalid path or content.');
            return;
          }
          try {
            const safePath = PathResolver.validateSafePath(filePath, this.projectPath);
            const relative = path.relative(this.projectPath, safePath);
            const parts = relative.split(/[\\/]/);
            if (parts.includes('.git') || parts.includes('.aura') || parts.includes('node_modules')) {
              this.sendError(socket, id, -32602, `Access denied to restricted path: ${filePath}`);
              return;
            }
            fs.mkdirSync(path.dirname(safePath), { recursive: true });
            fs.writeFileSync(safePath, content, 'utf-8');
            this.sendResult(socket, id, { success: true });
          } catch (err: unknown) {
            const msg = (err as Error).message ?? String(err);
            this.sendError(socket, id, -32603, `Write error: ${msg}`);
          }
          break;
        }

        case 'workspace/readFile': {
          const p = params as Record<string, unknown> | null | undefined;
          const filePath = p?.path;
          if (typeof filePath !== 'string') {
            this.sendError(socket, id, -32602, 'Invalid path.');
            return;
          }
          try {
            const safePath = PathResolver.validateSafePath(filePath, this.projectPath);
            const relative = path.relative(this.projectPath, safePath);
            const parts = relative.split(/[\\/]/);
            if (parts.includes('.git') || parts.includes('.aura') || parts.includes('node_modules')) {
              this.sendError(socket, id, -32602, `Access denied to restricted path: ${filePath}`);
              return;
            }
            if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) {
              this.sendError(socket, id, -32602, `File not found: ${filePath}`);
              return;
            }
            const content = fs.readFileSync(safePath, 'utf-8');
            this.sendResult(socket, id, { content });
          } catch (err: unknown) {
            const msg = (err as Error).message ?? String(err);
            this.sendError(socket, id, -32603, `Read error: ${msg}`);
          }
          break;
        }

        case 'workspace/getFileTree': {
          try {
            let totalItemsCount = 0;
            const buildTree = (currentDir: string, currentDepth: number): any[] => {
              const nodes: any[] = [];
              if (currentDepth > 4 || totalItemsCount >= 1000) return nodes;

              let children: string[] = [];
              try {
                children = fs.readdirSync(currentDir).sort();
              } catch (_e) {
                return nodes;
              }

              for (const name of children) {
                if (totalItemsCount >= 1000) break;
                if (name.startsWith('.')) continue;
                if (['node_modules', 'vendor', 'tmp', 'log', 'build', 'dist', 'coverage', 'state'].includes(name)) continue;

                const fullPath = path.join(currentDir, name);
                const relPath = path.relative(this.projectPath, fullPath).replace(/\\/g, '/');

                try {
                  const stat = fs.statSync(fullPath);
                  totalItemsCount++;
                  if (stat.isDirectory()) {
                    nodes.push({
                      name,
                      path: relPath,
                      type: 'dir',
                      children: buildTree(fullPath, currentDepth + 1)
                    });
                  } else if (stat.isFile()) {
                    nodes.push({
                      name,
                      path: relPath,
                      type: 'file'
                    });
                  }
                } catch (_e) {}
              }
              return nodes;
            };

            const tree = buildTree(this.projectPath, 1);
            this.sendResult(socket, id, { tree });
          } catch (err: unknown) {
            const msg = (err as Error).message ?? String(err);
            this.sendError(socket, id, -32603, `Failed to get file tree: ${msg}`);
          }
          break;
        }

        case 'garden/getStatus': {
          try {
            const sessionMgr = new SessionManager(this.projectPath);
            const sessionsList = sessionMgr.list({ includeMissing: false });
            let soilSize = 0;
            for (const session of sessionsList) {
              try {
                if (fs.existsSync(session.db_path)) {
                  soilSize += fs.statSync(session.db_path).size;
                }
                for (const suffix of ['-journal', '-wal', '-shm']) {
                  const sidecar = `${session.db_path}${suffix}`;
                  if (fs.existsSync(sidecar)) {
                    soilSize += fs.statSync(sidecar).size;
                  }
                }
              } catch {}
            }
            const sessionsCount = sessionsList.length;

            const dbPath = PathResolver.sessionDbPath(this.projectPath);
            let completedIds: string[] = [];
            if (fs.existsSync(dbPath)) {
              let db: Database.Database | undefined;
              try {
                db = new Database(dbPath);
                const tableRow = db
                  .prepare(
                    "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='events'",
                  )
                  .get() as { count: number } | undefined;
                if (tableRow && tableRow.count > 0) {
                  const anchorRows = db
                    .prepare("SELECT payload FROM events WHERE tool = 'anchor_submit'")
                    .all();
                  completedIds = anchorRows
                    .map((r: unknown) => {
                      try {
                        const row = r as { payload: string };
                        const payload = JSON.parse(row.payload);
                        return payload.anchor_id;
                      } catch {
                        return null;
                      }
                    })
                    .filter(Boolean) as string[];
                }
              } catch (e: unknown) {
                console.warn(`Error querying database: ${(e as Error).message}`);
              } finally {
                if (db) {
                  try {
                    db.close();
                  } catch {}
                }
              }
            }

            const anchorsDir = path.join(this.projectPath, 'anchors');
            let totalAnchors = 0;
            let completedAnchors = 0;
            const pendingAnchors: string[] = [];

            if (fs.existsSync(anchorsDir) && fs.statSync(anchorsDir).isDirectory()) {
              fs.readdirSync(anchorsDir).forEach((file) => {
                const full = path.join(anchorsDir, file);
                if (!fs.statSync(full).isFile()) return;
                const ext = path.extname(file).toLowerCase();
                if (!['.json', '.yaml', '.yml'].includes(ext)) return;

                totalAnchors++;
                try {
                  const content = fs.readFileSync(full, 'utf-8');
                  const data =
                    ext === '.json' ? JSON.parse(content) : yaml.parse(content);
                  const id = data.id || path.basename(file, ext);
                  if (completedIds.includes(id)) {
                    completedAnchors++;
                  } else {
                    pendingAnchors.push(id);
                  }
                } catch {
                  pendingAnchors.push(path.basename(file, ext));
                }
              });
            }

            const ratio = totalAnchors > 0 ? (completedAnchors / totalAnchors) * 100 : 0;
            const anchorsProgress = {
              completed: completedAnchors,
              total: totalAnchors,
              ratio: Number(ratio.toFixed(1)),
              pending: pendingAnchors,
            };

            let activeHintsCount = 0;
            try {
              const hintsProvider = new HintProvider(this.projectPath);
              const provided = hintsProvider.provide();
              if (provided) {
                activeHintsCount = provided.split('\n').filter(line => line.trim().length > 0).length;
              }
            } catch {}

            this.sendResult(socket, id, {
              soilSize,
              sessionsCount,
              anchorsProgress,
              activeHintsCount,
            });
          } catch (err: unknown) {
            const msg = (err as Error).message ?? String(err);
            this.sendError(socket, id, -32603, `Garden status error: ${msg}`);
          }
          break;
        }

        case 'garden/getAnchors': {
          try {
            const dbPath = PathResolver.sessionDbPath(this.projectPath);
            const completedMap = new Map<string, { summary: string, timestamp: number }>();
            if (fs.existsSync(dbPath)) {
              let db: Database.Database | undefined;
              try {
                db = new Database(dbPath);
                const tableRow = db
                  .prepare(
                    "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='events'",
                  )
                  .get() as { count: number } | undefined;
                if (tableRow && tableRow.count > 0) {
                  const anchorRows = db
                    .prepare("SELECT payload, timestamp FROM events WHERE tool = 'anchor_submit'")
                    .all() as { payload: string, timestamp: number }[];
                  for (const row of anchorRows) {
                    try {
                      const payload = JSON.parse(row.payload);
                      if (payload.anchor_id) {
                        completedMap.set(payload.anchor_id, {
                          summary: payload.summary || '',
                          timestamp: row.timestamp,
                        });
                      }
                    } catch {}
                  }
                }
              } catch (e: unknown) {
                console.warn(`Error querying database: ${(e as Error).message}`);
              } finally {
                if (db) {
                  try {
                    db.close();
                  } catch {}
                }
              }
            }

            const anchorsDir = path.join(this.projectPath, 'anchors');
            const anchors: any[] = [];

            if (fs.existsSync(anchorsDir) && fs.statSync(anchorsDir).isDirectory()) {
              const files = fs.readdirSync(anchorsDir);
              for (const file of files) {
                const full = path.join(anchorsDir, file);
                if (!fs.statSync(full).isFile()) continue;
                const ext = path.extname(file).toLowerCase();
                if (!['.json', '.yaml', '.yml'].includes(ext)) continue;

                try {
                  const content = fs.readFileSync(full, 'utf-8');
                  const data = ext === '.json' ? JSON.parse(content) : yaml.parse(content);
                  const id = data.id || path.basename(file, ext);
                  const completedInfo = completedMap.get(id);

                  anchors.push({
                    id,
                    name: data.name || id,
                    description: data.description || '',
                    call_when: Array.isArray(data.call_when) ? data.call_when : (data.call_when ? [data.call_when] : []),
                    status: completedInfo ? 'completed' : 'pending',
                    completedAt: completedInfo ? new Date(completedInfo.timestamp * 1000).toISOString() : undefined,
                    summary: completedInfo ? completedInfo.summary : undefined,
                  });
                } catch {
                  const id = path.basename(file, ext);
                  const completedInfo = completedMap.get(id);
                  anchors.push({
                    id,
                    status: completedInfo ? 'completed' : 'pending',
                    completedAt: completedInfo ? new Date(completedInfo.timestamp * 1000).toISOString() : undefined,
                    summary: completedInfo ? completedInfo.summary : undefined,
                  });
                }
              }
            }

            this.sendResult(socket, id, { anchors });
          } catch (err: unknown) {
            const msg = (err as Error).message ?? String(err);
            this.sendError(socket, id, -32603, `Get anchors error: ${msg}`);
          }
          break;
        }

        case 'garden/submitAnchor': {
          const p = params as Record<string, unknown> | null | undefined;
          const anchorId = p?.anchor_id;
          if (!anchorId || typeof anchorId !== 'string') {
            this.sendError(socket, id, -32602, 'Invalid anchor_id parameter.');
            return;
          }
          try {
            const dbPath = PathResolver.sessionDbPath(this.projectPath);
            const store = new SQLiteStore({ dbPath });
            try {
              if (p.revoke) {
                const rows = store.getRawDb().prepare("SELECT id, payload FROM events WHERE tool = 'anchor_submit'").all() as { id: number, payload: string }[];
                const toDelete: number[] = [];
                for (const row of rows) {
                  try {
                    const payload = JSON.parse(row.payload);
                    if (payload.anchor_id === anchorId) {
                      toDelete.push(row.id);
                    }
                  } catch {}
                }
                if (toDelete.length > 0) {
                  store.deleteEvents(toDelete);
                }
              } else {
                store.insertEvent({
                  timestamp: Math.floor(Date.now() / 1000),
                  phase: 'tool',
                  tool: 'anchor_submit',
                  payload: {
                    anchor_id: anchorId,
                    summary: p.summary || '',
                  },
                });
              }
              this.sendResult(socket, id, { success: true });
            } finally {
              store.close();
            }
          } catch (err: unknown) {
            const msg = (err as Error).message ?? String(err);
            this.sendError(socket, id, -32603, `Submit anchor error: ${msg}`);
          }
          break;
        }

        case 'daemon/status': {
          this.sendResult(socket, id, {
            projectPath: this.projectPath,
            activeSession: this.runner ? this.runner.sessionName : 'default',
            jobStatus: this.activeLoopJob.status,
            connectionsCount: this.connections.size,
          });
          break;
        }

        case 'daemon/exit': {
          this.sendResult(socket, id, { exiting: true });
          setImmediate(() => this.stop());
          break;
        }

        default:
          this.sendError(socket, id, -32601, `Method not found: ${method}`);
      }
    } catch (err: unknown) {
      const msg = (err as Error).message ?? String(err);
      this.sendError(socket, id, -32603, `Internal error: ${msg}`);
    }
  }

  private askClientConfirmation(
    socket: net.Socket,
    message: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const requestId = `confirm-${Date.now()}`;
      this.pendingClientRequests.set(requestId, (result: unknown) => {
        resolve(!!result);
      });
      if (!socket.destroyed) {
        socket.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: requestId,
            method: 'client/confirm',
            params: { message },
          })}\n`,
        );
      } else {
        resolve(false);
      }
    });
  }

  private sendResult(socket: net.Socket, id: unknown, result: unknown): void {
    if (!socket.destroyed) {
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
    }
  }

  private sendError(
    socket: net.Socket,
    id: unknown,
    code: number,
    message: string,
  ): void {
    if (!socket.destroyed) {
      socket.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`,
      );
    }
  }

  private sendNotification(method: string, params: unknown): void {
    const frame = `${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`;
    for (const socket of this.connections) {
      if (!socket.destroyed) {
        socket.write(frame);
      }
    }
  }
}

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import yaml from 'yaml';
import { HintProvider } from '../core/context/providers/hintProvider.js';
import { Bridge } from '../core/interface/bridge.js';
import { RalphLoop } from '../core/kernel/ralphLoop.js';
import { Runner } from '../core/kernel/runner.js';
import { SessionManager } from '../core/memory/sessionManager.js';
import { SQLiteStore } from '../core/memory/sqliteStore.js';
import * as PathResolver from '../utils/pathResolver.js';
import { resolveIpcPath } from './ipc.js';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
}

interface AnchorInfo {
  id: string;
  name?: string;
  description?: string;
  call_when?: string[];
  status: 'completed' | 'pending';
  completedAt?: string;
  summary?: string;
}

/**
 * DaemonServer acts as the local persistent engine for Aura OS.
 * It manages workspace lifecycle, runs agentic loops, and streams notifications.
 */
export class DaemonServer {
  private server: net.Server | null = null;
  private projectPath: string;
  public readonly socketPath: string;
  private runner: Runner | null = null;
  private sessionManager: SessionManager;
  public activeLoopJob: {
    status: 'running' | 'idle';
    goal?: string;
    mode?: string;
  } = { status: 'idle' };
  private connections = new Set<net.Socket>();
  private idleTimer: NodeJS.Timeout | null = null;
  private pendingClientRequests = new Map<
    string,
    { socket: net.Socket; resolve: (result: unknown) => void }
  >();
  private activeAbortController: AbortController | null = null;
  private activeJobSocket: net.Socket | null = null;
  private static readonly IDLE_TIMEOUT_MS = 600000; // 10 minutes

  constructor(projectPath: string) {
    this.projectPath = path.resolve(projectPath);
    this.socketPath = resolveIpcPath(this.projectPath);
    this.sessionManager = new SessionManager(this.projectPath);
  }

  public async start(): Promise<void> {
    // Named pipes on Windows are auto-released on process exit; no unlink needed.
    if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
      const isAlive = await new Promise<boolean>((resolve) => {
        const conn = net.createConnection(this.socketPath);
        conn.on('connect', () => {
          conn.end();
          resolve(true);
        });
        conn.on('error', () => {
          resolve(false);
        });
      });
      if (isAlive) {
        throw new Error(
          `Another Aura Daemon is already running on IPC path: ${this.socketPath}`,
        );
      }
      try {
        fs.unlinkSync(this.socketPath);
      } catch {}
    }

    this.server = net.createServer((socket) => {
      this.connections.add(socket);
      this.resetIdleTimer();

      const rl = readline.createInterface({
        input: socket,
        terminal: false,
      });

      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (trimmed) {
          this.handleMessage(socket, trimmed);
        }
      });

      const handleClose = () => {
        rl.close();
        this.connections.delete(socket);
        this.cancelPendingRequestsForSocket(socket);
        if (socket === this.activeJobSocket) {
          this.activeAbortController?.abort();
        }
        this.resetIdleTimer();
      };

      socket.on('close', handleClose);
      socket.on('error', handleClose);
    });

    return new Promise((resolve, reject) => {
      this.server?.listen(this.socketPath, () => {
        console.log(`Aura Daemon listening on IPC path: ${this.socketPath}`);
        RalphLoop.cleanupOrphanedRalphSessions(this.projectPath);
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
    // Named pipes on Windows are auto-released; no unlink needed.
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
      const errMsg = (err as Error).message ?? String(err);
      this.sendError(socket, null, -32700, `Parse error: ${errMsg}`);
      return;
    }

    const { method, params, id, result, error } = msg;

    // Validate JSON-RPC 2.0 structure. msg is null if JSON.parse('null') was executed.
    if (msg === null || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
      this.sendError(
        socket,
        msg !== null && msg.id !== undefined ? msg.id : null,
        -32600,
        'Invalid Request',
      );
      return;
    }

    if (typeof id === 'string') {
      const req = this.pendingClientRequests.get(id);
      if (req) {
        this.pendingClientRequests.delete(id);
        req.resolve(result !== undefined ? result : error);
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
          if (this.activeLoopJob.status === 'running') {
            this.sendError(
              socket,
              id,
              -32603,
              'Cannot initialize workspace while a goal loop is running.',
            );
            return;
          }
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

          this.activeAbortController = new AbortController();
          this.activeJobSocket = socket;
          const signal = this.activeAbortController.signal;

          const disconnectHook = () => {
            if (signal.aborted || socket.destroyed) {
              throw new Error('Client socket disconnected');
            }
            return true;
          };

          const confirmHook = async (tool: unknown, _args: unknown) => {
            const runner = this.runner;
            if (!runner) {
              return true;
            }
            const config = runner.loadConfig();
            const security = config?.security as
              | Record<string, unknown>
              | undefined;
            const confirmEnabled = security?.confirm_dangerous_tools === true;

            if (!confirmEnabled) {
              return true;
            }

            const isAutoJob = runner.currentJob?.metadata?.auto_mode || false;
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

          this.runner.hooks.register('before_planning', disconnectHook);
          this.runner.hooks.register('before_tool_execution', disconnectHook);
          this.runner.hooks.register('before_tool_execution', confirmHook);

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
                signal,
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

              try {
                await bridge.chat(goal, { auto_mode: isAuto as boolean });
              } catch (_err: unknown) {
                status = 'failed';
              }

              this.sendResult(socket, id, { status, final_content });
            }
          } finally {
            if (this.runner) {
              this.runner.hooks.unregister('before_planning', disconnectHook);
              this.runner.hooks.unregister(
                'before_tool_execution',
                disconnectHook,
              );
              this.runner.hooks.unregister(
                'before_tool_execution',
                confirmHook,
              );
            }
            this.activeLoopJob = { status: 'idle' };
            this.activeAbortController = null;
            this.activeJobSocket = null;
            this.resetIdleTimer();
          }
          break;
        }

        case 'session/list': {
          const sessionMgr = this.sessionManager;
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
          const sessionMgr = this.sessionManager;
          const session = sessionMgr.create(name, p);
          this.sendResult(socket, id, { session });
          break;
        }

        case 'session/activate': {
          if (this.activeLoopJob.status === 'running') {
            this.sendError(
              socket,
              id,
              -32603,
              'Cannot activate session while a goal loop is running.',
            );
            return;
          }
          const p = params as Record<string, unknown> | null | undefined;
          const name = p?.name;
          if (!name || typeof name !== 'string') {
            this.sendError(socket, id, -32602, 'Invalid session name.');
            return;
          }
          const sessionMgr = this.sessionManager;
          sessionMgr.activate(name);
          if (this.runner) {
            this.runner.reconnectSession(name);
          }
          this.sendResult(socket, id, { activeSession: name });
          break;
        }

        case 'session/delete': {
          if (this.activeLoopJob.status === 'running') {
            this.sendError(
              socket,
              id,
              -32603,
              'Cannot delete session while a goal loop is running.',
            );
            return;
          }
          const p = params as Record<string, unknown> | null | undefined;
          const name = p?.name;
          if (!name || typeof name !== 'string') {
            this.sendError(socket, id, -32602, 'Invalid session name.');
            return;
          }
          const sessionMgr = this.sessionManager;
          const activeSession = this.runner
            ? this.runner.sessionName
            : sessionMgr.currentName() || 'default';
          if (name === activeSession) {
            this.sendError(
              socket,
              id,
              -32602,
              `Cannot delete the active session: ${name}`,
            );
            return;
          }
          const success = sessionMgr.delete(name);
          this.sendResult(socket, id, { success });
          break;
        }

        case 'session/rename': {
          if (this.activeLoopJob.status === 'running') {
            this.sendError(
              socket,
              id,
              -32603,
              'Cannot rename session while a goal loop is running.',
            );
            return;
          }
          const p = params as Record<string, unknown> | null | undefined;
          const oldName = p?.oldName;
          const newName = p?.newName;
          if (
            !oldName ||
            typeof oldName !== 'string' ||
            !newName ||
            typeof newName !== 'string'
          ) {
            this.sendError(socket, id, -32602, 'Invalid session names.');
            return;
          }
          const sessionMgr = this.sessionManager;
          const session = sessionMgr.rename(oldName, newName);
          if (this.runner && this.runner.sessionName === oldName) {
            this.runner.reconnectSession(newName);
          }
          this.sendResult(socket, id, { session });
          break;
        }

        case 'session/duplicate': {
          if (this.activeLoopJob.status === 'running') {
            this.sendError(
              socket,
              id,
              -32603,
              'Cannot duplicate session while a goal loop is running.',
            );
            return;
          }
          const p = params as Record<string, unknown> | null | undefined;
          const sourceName = p?.sourceName;
          const newName = p?.newName;
          if (
            !sourceName ||
            typeof sourceName !== 'string' ||
            !newName ||
            typeof newName !== 'string'
          ) {
            this.sendError(socket, id, -32602, 'Invalid session names.');
            return;
          }
          const sessionMgr = this.sessionManager;
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
            const safePath = PathResolver.validateSafePath(
              filePath,
              this.projectPath,
            );
            const relative = path.relative(this.projectPath, safePath);
            const parts = relative.split(/[\\/]/);
            if (
              parts.includes('.git') ||
              parts.includes('.aura') ||
              parts.includes('node_modules')
            ) {
              this.sendError(
                socket,
                id,
                -32602,
                `Access denied to restricted path: ${filePath}`,
              );
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
            const safePath = PathResolver.validateSafePath(
              filePath,
              this.projectPath,
            );
            const relative = path.relative(this.projectPath, safePath);
            const parts = relative.split(/[\\/]/);
            if (
              parts.includes('.git') ||
              parts.includes('.aura') ||
              parts.includes('node_modules')
            ) {
              this.sendError(
                socket,
                id,
                -32602,
                `Access denied to restricted path: ${filePath}`,
              );
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
            const buildTree = (
              currentDir: string,
              currentDepth: number,
            ): FileNode[] => {
              const nodes: FileNode[] = [];
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

                const fullPath = path.join(currentDir, name);
                const relPath = path
                  .relative(this.projectPath, fullPath)
                  .replace(/\\/g, '/');

                const isIgnored = Runner.IGNORED_SCAN_DIRS.some(
                  (d) =>
                    relPath === d ||
                    relPath.startsWith(`${d}/`) ||
                    relPath.includes(`/${d}/`),
                );
                if (isIgnored) continue;

                try {
                  const stat = fs.statSync(fullPath);
                  totalItemsCount++;
                  if (stat.isDirectory()) {
                    nodes.push({
                      name,
                      path: relPath,
                      type: 'dir',
                      children: buildTree(fullPath, currentDepth + 1),
                    });
                  } else if (stat.isFile()) {
                    nodes.push({
                      name,
                      path: relPath,
                      type: 'file',
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
            this.sendError(
              socket,
              id,
              -32603,
              `Failed to get file tree: ${msg}`,
            );
          }
          break;
        }

        case 'garden/getStatus': {
          try {
            const sessionMgr = this.sessionManager;
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

            const activeSession = this.runner
              ? this.runner.sessionName
              : 'default';
            const dbPath = PathResolver.sessionDbPath(
              this.projectPath,
              activeSession,
            );
            let completedIds: string[] = [];
            if (fs.existsSync(dbPath)) {
              const store = new SQLiteStore({ dbPath });
              try {
                const events = store.fetchAnchorSubmitEvents();
                completedIds = events
                  .map((e) => e.payload.anchor_id)
                  .filter(Boolean) as string[];
              } catch (e: unknown) {
                console.warn(
                  `Error querying database: ${(e as Error).message}`,
                );
              } finally {
                store.close();
              }
            }

            const anchorsDir = path.join(this.projectPath, 'anchors');
            let totalAnchors = 0;
            let completedAnchors = 0;
            const pendingAnchors: string[] = [];

            if (
              fs.existsSync(anchorsDir) &&
              fs.statSync(anchorsDir).isDirectory()
            ) {
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

            const ratio =
              totalAnchors > 0 ? (completedAnchors / totalAnchors) * 100 : 0;
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
                activeHintsCount = provided
                  .split('\n')
                  .filter((line) => line.trim().length > 0).length;
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
            const activeSession = this.runner
              ? this.runner.sessionName
              : 'default';
            const dbPath = PathResolver.sessionDbPath(
              this.projectPath,
              activeSession,
            );
            const completedMap = new Map<
              string,
              { summary: string; timestamp: number }
            >();
            if (fs.existsSync(dbPath)) {
              const store = new SQLiteStore({ dbPath });
              try {
                const events = store.fetchAnchorSubmitEvents();
                for (const event of events) {
                  if (event.payload.anchor_id) {
                    completedMap.set(event.payload.anchor_id as string, {
                      summary: (event.payload.summary as string) || '',
                      timestamp: event.timestamp,
                    });
                  }
                }
              } catch (e: unknown) {
                console.warn(
                  `Error querying database: ${(e as Error).message}`,
                );
              } finally {
                store.close();
              }
            }

            const anchorsDir = path.join(this.projectPath, 'anchors');
            const anchors: AnchorInfo[] = [];

            if (
              fs.existsSync(anchorsDir) &&
              fs.statSync(anchorsDir).isDirectory()
            ) {
              const files = fs.readdirSync(anchorsDir);
              for (const file of files) {
                const full = path.join(anchorsDir, file);
                if (!fs.statSync(full).isFile()) continue;
                const ext = path.extname(file).toLowerCase();
                if (!['.json', '.yaml', '.yml'].includes(ext)) continue;

                try {
                  const content = fs.readFileSync(full, 'utf-8');
                  const data =
                    ext === '.json' ? JSON.parse(content) : yaml.parse(content);
                  const id = data.id || path.basename(file, ext);
                  const completedInfo = completedMap.get(id);

                  anchors.push({
                    id,
                    name: data.name || id,
                    description: data.description || '',
                    call_when: Array.isArray(data.call_when)
                      ? data.call_when
                      : data.call_when
                        ? [data.call_when]
                        : [],
                    status: completedInfo ? 'completed' : 'pending',
                    completedAt: completedInfo
                      ? new Date(completedInfo.timestamp * 1000).toISOString()
                      : undefined,
                    summary: completedInfo ? completedInfo.summary : undefined,
                  });
                } catch {
                  const id = path.basename(file, ext);
                  const completedInfo = completedMap.get(id);
                  anchors.push({
                    id,
                    status: completedInfo ? 'completed' : 'pending',
                    completedAt: completedInfo
                      ? new Date(completedInfo.timestamp * 1000).toISOString()
                      : undefined,
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
            const activeSession = this.runner
              ? this.runner.sessionName
              : 'default';
            const dbPath = PathResolver.sessionDbPath(
              this.projectPath,
              activeSession,
            );
            const store = new SQLiteStore({ dbPath });
            try {
              if (p.revoke) {
                const rows = store
                  .getRawDb()
                  .prepare(
                    "SELECT id, payload FROM events WHERE tool = 'anchor_submit'",
                  )
                  .all() as { id: number; payload: string }[];
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
      const requestId = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      this.pendingClientRequests.set(requestId, {
        socket,
        resolve: (result: unknown) => {
          resolve(!!result);
        },
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

  private cancelPendingRequestsForSocket(socket: net.Socket): void {
    for (const [requestId, req] of this.pendingClientRequests.entries()) {
      if (req.socket === socket) {
        req.resolve(false);
        this.pendingClientRequests.delete(requestId);
      }
    }
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

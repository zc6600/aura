import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Bridge } from '../core/interface/bridge.js';
import { RalphLoop } from '../core/kernel/ralphLoop.js';
import { Runner } from '../core/kernel/runner.js';
import { resolveIpcPath } from './ipc.js';

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

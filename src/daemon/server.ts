import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { RalphLoop } from '../core/kernel/ralphLoop.js';
import type { Runner } from '../core/kernel/runner.js';
import { SessionManager } from '../core/memory/sessionManager.js';
import { resolveIpcPath } from './ipc.js';
import { dispatchRequest } from './router.js';

/**
 * DaemonServer acts as the local persistent engine for Aura OS.
 * It manages workspace lifecycle, runs agentic loops, and streams notifications.
 */
export class DaemonServer {
  private server: net.Server | null = null;
  public readonly projectPath: string;
  public readonly socketPath: string;
  public runner: Runner | null = null;
  public readonly sessionManager: SessionManager;
  public activeLoopJob: {
    status: 'running' | 'idle';
    goal?: string;
    mode?: string;
  } = { status: 'idle' };
  public readonly connections = new Set<net.Socket>();
  public idleTimer: NodeJS.Timeout | null = null;
  private pendingClientRequests = new Map<
    string,
    { socket: net.Socket; resolve: (result: unknown) => void }
  >();
  public activeAbortController: AbortController | null = null;
  public activeJobSocket: net.Socket | null = null;
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

  public resetIdleTimer(): void {
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

  public clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
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
    const ctx = {
      server: this,
      socket,
      id,
      params,
    };
    await dispatchRequest(method, ctx);
  }

  public askClientConfirmation(
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

  public sendResult(socket: net.Socket, id: unknown, result: unknown): void {
    if (!socket.destroyed) {
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
    }
  }

  public sendError(
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

  public sendNotification(method: string, params: unknown): void {
    const frame = `${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`;
    for (const socket of this.connections) {
      if (!socket.destroyed) {
        socket.write(frame);
      }
    }
  }
}

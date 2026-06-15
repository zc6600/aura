import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { readLastLinesSync } from '../utils/fsUtils.js';
import { auraHome } from '../utils/globalConfig.js';
import { resolveIpcPath } from './ipc.js';

/**
 * DaemonClient provides the programmatic API wrapper for interacting
 * with the background Aura Daemon over the local socket pipe.
 */
export class DaemonClient {
  private projectPath: string;
  private socketPath: string;
  private socket: net.Socket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (val: unknown) => void; reject: (err: Error) => void }
  >();
  private notificationListeners = new Set<
    (method: string, params: Record<string, unknown>) => void
  >();
  private confirmHandler: ((message: string) => Promise<boolean>) | null = null;

  constructor(projectPath: string) {
    this.projectPath = path.resolve(projectPath);
    this.socketPath = resolveIpcPath(this.projectPath);
  }

  public async connect(autoLaunch = true): Promise<void> {
    try {
      await this.tryConnect();
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (autoLaunch && (e.code === 'ECONNREFUSED' || e.code === 'ENOENT')) {
        console.log(
          'Aura Daemon is not running. Launching background server...',
        );
        await this.launchDaemon();
        await this.tryConnect();
      } else {
        throw err;
      }
    }
  }

  private tryConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      let connected = false;

      socket.on('connect', () => {
        connected = true;
        this.socket = socket;
        this.startReadLoop();
        resolve();
      });

      socket.on('error', (err) => {
        if (!connected) {
          reject(err);
        }
      });
    });
  }

  private async launchDaemon(): Promise<void> {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    let entryScript = '';
    const candidates = [
      path.resolve(__dirname, 'bin', 'daemon.js'),
      path.resolve(__dirname, 'daemon.js'),
      path.resolve(__dirname, '..', 'bin', 'daemon.js'),
      path.resolve(__dirname, '..', 'bin', 'daemon.ts'),
      path.resolve(__dirname, '..', '..', 'bin', 'daemon.ts'),
      path.resolve(__dirname, '..', 'dist', 'bin', 'daemon.js'),
      path.resolve(__dirname, '..', 'src', 'bin', 'daemon.ts'),
      path.resolve(__dirname, '..', '..', 'dist', 'bin', 'daemon.js'),
      path.resolve(__dirname, '..', '..', 'src', 'bin', 'daemon.ts'),
    ];

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        entryScript = cand;
        break;
      }
    }

    if (!entryScript) {
      throw new Error(
        `Failed to locate daemon script (checked: ${candidates.join(', ')})`,
      );
    }

    let command = process.execPath;
    const args: string[] = [];

    if (entryScript.endsWith('.ts')) {
      const tsxCli = process.argv.find((arg) => arg.includes('tsx'));
      if (tsxCli) {
        args.push(tsxCli, entryScript);
      } else {
        command = 'npx';
        args.push('-y', 'tsx', entryScript);
      }
    } else {
      args.push(entryScript);
    }

    args.push(this.projectPath);

    const hash = path
      .basename(this.socketPath)
      .replace('daemon-', '')
      .replace('.sock', '')
      .replace('aura-', '');

    let logDir = path.join(auraHome(), 'logs');
    try {
      fs.mkdirSync(logDir, { recursive: true });
    } catch {
      logDir = path.join(os.tmpdir(), '.aura-framework-logs');
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, `daemon-${hash}.log`);
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');

    // Spawn detached Node process running 'aura daemon'
    const child = spawn(command, args, {
      detached: true,
      stdio: ['ignore', out, err],
      env: { ...process.env, AURA_ALLOW_ROOT: 'true' },
    });

    try {
      fs.closeSync(out);
      fs.closeSync(err);
    } catch {}

    let childExited = false;
    let exitCode: number | null = null;
    let signalReceived: string | null = null;
    child.on('exit', (code, sig) => {
      childExited = true;
      exitCode = code;
      signalReceived = sig;
    });

    child.unref();

    // Wait for the socket connection to become available
    for (let attempts = 0; attempts < 30; attempts++) {
      if (childExited) {
        let logTail = '';
        try {
          if (fs.existsSync(logFile)) {
            logTail = readLastLinesSync(logFile, 15);
          }
        } catch {}
        throw new Error(
          `Aura Daemon exited unexpectedly during start-up with code ${exitCode} (signal: ${signalReceived}).\nLast log lines:\n${logTail}`,
        );
      }
      if (fs.existsSync(this.socketPath)) {
        try {
          const testSocket = net.createConnection(this.socketPath);
          await new Promise<void>((res, rej) => {
            testSocket.on('connect', () => {
              testSocket.destroy();
              res();
            });
            testSocket.on('error', (e) => {
              testSocket.destroy();
              rej(e);
            });
          });
          return;
        } catch {
          // Socket exists but not accepting connections yet, wait
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('Timed out waiting for Aura Daemon to start.');
  }

  private startReadLoop(): void {
    if (!this.socket) return;

    const rl = readline.createInterface({
      input: this.socket,
      terminal: false,
    });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed) {
        this.handleMessage(trimmed);
      }
    });

    this.socket.on('close', () => {
      rl.close();
      this.rejectAllPending(new Error('Connection to Aura Daemon closed.'));
      this.socket = null;
    });

    this.socket.on('error', (err) => {
      rl.close();
      this.rejectAllPending(err);
      this.socket = null;
    });
  }

  private handleMessage(line: string): void {
    try {
      const msg = JSON.parse(line);
      const { id, result, error, method, params } = msg;

      const pending =
        id !== undefined ? this.pendingRequests.get(id) : undefined;
      if (pending) {
        this.pendingRequests.delete(id);
        const { resolve, reject } = pending;
        if (error) {
          reject(new Error(error.message || `RPC Error (${error.code})`));
        } else {
          resolve(result);
        }
      } else if (method) {
        if (id !== undefined) {
          this.handleServerRequest(id, method, params);
        } else {
          for (const listener of this.notificationListeners) {
            listener(method, params);
          }
        }
      }
    } catch (err: unknown) {
      console.warn('[DaemonClient] Failed to parse server message:', line, err);
    }
  }

  public request(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        return reject(new Error('Not connected to Aura Daemon.'));
      }
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });
      this.socket.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
      );
    });
  }

  public onNotification(
    listener: (method: string, params: Record<string, unknown>) => void,
  ): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  public onConfirmRequest(
    handler: (message: string) => Promise<boolean>,
  ): void {
    this.confirmHandler = handler;
  }

  private async handleServerRequest(
    id: string | number,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    if (method === 'client/confirm') {
      const message = (params?.message as string) || '';
      let answer = false;
      if (this.confirmHandler) {
        answer = await this.confirmHandler(message);
      } else {
        console.log(`\n⚠️ ${message}`);
        answer = false;
      }
      if (this.socket && !this.socket.destroyed) {
        this.socket.write(
          `${JSON.stringify({ jsonrpc: '2.0', id, result: answer })}\n`,
        );
      }
    } else {
      if (this.socket && !this.socket.destroyed) {
        this.socket.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          })}\n`,
        );
      }
    }
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [_id, { reject }] of this.pendingRequests.entries()) {
      reject(err);
    }
    this.pendingRequests.clear();
  }
}

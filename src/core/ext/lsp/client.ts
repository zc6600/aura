import { type ChildProcess, spawn } from 'node:child_process';
import EventEmitter from 'node:events';

export class LSPClient extends EventEmitter {
  private command: string;
  private args: string[];
  private env: Record<string, string>;
  private timeout: number;
  private nextId = 1;
  private process: ChildProcess | null = null;
  private serverCapabilities: Record<string, unknown> = {};
  public running = false;
  public initialized = false;
  private forceKillTimer?: NodeJS.Timeout;

  private handlers = new Map<
    string,
    {
      resolve: (val: Record<string, unknown>) => void;
      reject: (err: unknown) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private stdoutBuffer = Buffer.alloc(0);

  constructor(
    command: string,
    args: string[] = [],
    env: Record<string, string> = {},
    timeout = 30,
  ) {
    super();
    this.command = command;
    this.args = args || [];
    this.env = env || {};
    this.timeout = timeout || 30;
  }

  public start(): void {
    if (this.process) return;
    this.running = true;

    const spawnEnv = { ...process.env, ...this.env };
    this.process = spawn(this.command, this.args, {
      env: spawnEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.handleStdout(chunk);
    });

    this.process.stderr?.on('data', (_chunk: Buffer) => {
      // Can be logged if needed
    });

    this.process.on('close', (code) => {
      if (this.forceKillTimer) {
        clearTimeout(this.forceKillTimer);
        this.forceKillTimer = undefined;
      }
      this.cleanup(new Error(`LSP server closed with code ${code}`));
    });

    this.process.on('error', (err) => {
      this.cleanup(err);
    });
  }

  public stop(): void {
    this.running = false;
    if (this.process) {
      try {
        this.process.stdin?.end();
      } catch (_e) {}
      try {
        this.process.kill('SIGTERM');
      } catch (_e) {}
      const proc = this.process;
      if (this.forceKillTimer) {
        clearTimeout(this.forceKillTimer);
      }
      this.forceKillTimer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch (_e) {}
        this.forceKillTimer = undefined;
      }, 1000);
      this.process = null;
    }
    this.cleanup(new Error('LSP client stopped'));
  }

  public async initializeServer(
    rootPath: string,
  ): Promise<Record<string, unknown>> {
    this.start();
    const resp = await this.request('initialize', {
      processId: process.pid,
      rootPath: rootPath,
      rootUri: `file://${rootPath.replace(/\\/g, '/')}`,
      capabilities: this.clientCapabilities(),
      initializationOptions: {},
    });

    if (resp?.result) {
      const result = (resp as Record<string, unknown>).result as Record<
        string,
        unknown
      >;
      // LSP initialize result has shape { capabilities: {...} }
      this.serverCapabilities =
        (result?.capabilities as Record<string, unknown>) ?? result ?? {};
      try {
        this.notify('initialized', {});
      } catch (_e) {}
      this.initialized = true;
    }
    return resp as Record<string, unknown>;
  }

  public request(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const id = String(this.nextId++);
      const payload = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      const timer = setTimeout(() => {
        const handler = this.handlers.get(id);
        if (handler) {
          this.handlers.delete(id);
          reject(new Error(`lsp request timeout: ${method}`));
        }
      }, this.timeout * 1000);

      this.handlers.set(id, { resolve, reject, timer });
      this.writeMessage(payload);
    });
  }

  public notify(method: string, params?: Record<string, unknown>): void {
    const payload = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.writeMessage(payload);
  }

  public onNotification(
    method: string,
    callback: (params: unknown) => void,
  ): void {
    this.on(`notification:${method}`, callback);
  }

  public get server_capabilities(): Record<string, unknown> {
    return this.serverCapabilities;
  }

  private writeMessage(payload: Record<string, unknown>): void {
    if (!this.process?.stdin) return;
    const body = JSON.stringify(payload);
    const byteLength = Buffer.byteLength(body, 'utf-8');
    const header = `Content-Length: ${byteLength}\r\n\r\n`;
    try {
      this.process.stdin.write(header + body);
    } catch (_e) {}
  }

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);

    while (true) {
      const str = this.stdoutBuffer.toString('utf-8');
      const headerMatch = str.match(/^Content-Length:\s*(\d+)\r\n\r\n/i);
      if (!headerMatch) {
        const doubleNewlineIndex = str.indexOf('\r\n\r\n');
        if (doubleNewlineIndex !== -1 && !str.startsWith('Content-Length:')) {
          this.stdoutBuffer = this.stdoutBuffer.subarray(
            doubleNewlineIndex + 4,
          );
          continue;
        }
        break;
      }

      const contentLength = parseInt(headerMatch[1], 10);
      const headerBytes = Buffer.byteLength(headerMatch[0], 'utf-8');
      const totalBytesNeeded = headerBytes + contentLength;

      if (this.stdoutBuffer.length < totalBytesNeeded) {
        break;
      }

      const bodyBuffer = this.stdoutBuffer.subarray(
        headerBytes,
        totalBytesNeeded,
      );
      this.stdoutBuffer = this.stdoutBuffer.subarray(totalBytesNeeded);

      try {
        const msg = JSON.parse(bodyBuffer.toString('utf-8'));
        this.handleMessage(msg);
      } catch (e) {
        console.warn(
          `[LSPClient] Failed to parse LSP message: ${(e as Error).message}`,
        );
      }
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    if (msg.id !== undefined && msg.id !== null) {
      const id = String(msg.id);
      const handler = this.handlers.get(id);
      if (handler) {
        clearTimeout(handler.timer);
        this.handlers.delete(id);
        if (msg.error) {
          handler.reject(
            new Error(
              (msg.error as { message: string }).message || 'LSP error',
            ),
          );
        } else {
          handler.resolve(msg);
        }
      }
    } else if (msg.method) {
      this.emit(`notification:${msg.method}`, msg.params);
    }
  }

  private cleanup(err: Error): void {
    for (const [_id, handler] of this.handlers.entries()) {
      clearTimeout(handler.timer);
      handler.reject(err);
    }
    this.handlers.clear();
    this.running = false;
    this.initialized = false;
    this.process = null;
  }

  private clientCapabilities(): Record<string, unknown> {
    return {
      textDocument: {
        synchronization: { dynamicRegistration: true, didSave: true },
        publishDiagnostics: { relatedInformation: true },
      },
      workspace: { configuration: true },
    };
  }
}

import { spawn, ChildProcess } from 'child_process';
import EventEmitter from 'events';

export class LSPClient extends EventEmitter {
  private command: string;
  private args: string[];
  private env: Record<string, string>;
  private timeout: number;
  private nextId = 1;
  private process: ChildProcess | null = null;
  private running = false;
  private initialized = false;
  private serverCapabilities: any = {};
  
  private handlers = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void; timer: NodeJS.Timeout }>();
  private stdoutBuffer = Buffer.alloc(0);

  constructor(command: string, args: string[] = [], env: Record<string, string> = {}, timeout = 30) {
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
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.handleStdout(chunk);
    });

    this.process.stderr?.on('data', (chunk: Buffer) => {
      // Can be logged if needed
    });

    this.process.on('close', (code) => {
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
      } catch (e) {}
      try {
        this.process.kill('SIGTERM');
      } catch (e) {}
      const proc = this.process;
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch (e) {}
      }, 1000);
      this.process = null;
    }
    this.cleanup(new Error('LSP client stopped'));
  }

  public async initializeServer(rootPath: string): Promise<any> {
    this.start();
    const resp = await this.request('initialize', {
      processId: process.pid,
      rootPath: rootPath,
      rootUri: `file://${rootPath.replace(/\\/g, '/')}`,
      capabilities: this.clientCapabilities(),
      initializationOptions: {}
    });

    if (resp && resp.result) {
      this.serverCapabilities = resp.result.capabilities;
      try {
        this.notify('initialized', {});
      } catch (e) {}
      this.initialized = true;
    }
    return resp;
  }

  public request(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = String(this.nextId++);
      const payload = {
        jsonrpc: '2.0',
        id,
        method,
        params
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

  public notify(method: string, params?: any): void {
    const payload = {
      jsonrpc: '2.0',
      method,
      params
    };
    this.writeMessage(payload);
  }

  public onNotification(method: string, callback: (params: any) => void): void {
    this.on(`notification:${method}`, callback);
  }

  public get server_capabilities(): any {
    return this.serverCapabilities;
  }

  private writeMessage(payload: any): void {
    if (!this.process || !this.process.stdin) return;
    const body = JSON.stringify(payload);
    const byteLength = Buffer.byteLength(body, 'utf-8');
    const header = `Content-Length: ${byteLength}\r\n\r\n`;
    try {
      this.process.stdin.write(header + body);
    } catch (e) {}
  }

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);

    while (true) {
      const str = this.stdoutBuffer.toString('utf-8');
      const headerMatch = str.match(/^Content-Length:\s*(\d+)\r\n\r\n/i);
      if (!headerMatch) {
        const doubleNewlineIndex = str.indexOf('\r\n\r\n');
        if (doubleNewlineIndex !== -1 && !str.startsWith('Content-Length:')) {
          this.stdoutBuffer = this.stdoutBuffer.subarray(doubleNewlineIndex + 4);
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

      const bodyBuffer = this.stdoutBuffer.subarray(headerBytes, totalBytesNeeded);
      this.stdoutBuffer = this.stdoutBuffer.subarray(totalBytesNeeded);

      try {
        const msg = JSON.parse(bodyBuffer.toString('utf-8'));
        this.handleMessage(msg);
      } catch (e) {
        console.warn(`[LSPClient] Failed to parse LSP message: ${(e as Error).message}`);
      }
    }
  }

  private handleMessage(msg: any): void {
    if (msg.id !== undefined && msg.id !== null) {
      const id = String(msg.id);
      const handler = this.handlers.get(id);
      if (handler) {
        clearTimeout(handler.timer);
        this.handlers.delete(id);
        if (msg.error) {
          handler.reject(new Error(msg.error.message || 'LSP error'));
        } else {
          handler.resolve(msg);
        }
      }
    } else if (msg.method) {
      this.emit(`notification:${msg.method}`, msg.params);
    }
  }

  private cleanup(err: Error): void {
    for (const [id, handler] of this.handlers.entries()) {
      clearTimeout(handler.timer);
      handler.reject(err);
    }
    this.handlers.clear();
  }

  private clientCapabilities(): any {
    return {
      textDocument: {
        synchronization: { dynamicRegistration: true, didSave: true },
        publishDiagnostics: { relatedInformation: true }
      },
      workspace: { configuration: true }
    };
  }
}

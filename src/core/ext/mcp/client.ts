import { type ChildProcess, spawn } from 'node:child_process';
import readline from 'node:readline';
import { VERSION } from '../../../utils/version.js';

export class StdioClient {
  private command: string;
  private args: string[];
  private env: Record<string, string>;
  private timeout: number;
  private nextId = 1;
  private process: ChildProcess | null = null;
  private initialized = false;
  private rl: readline.Interface | null = null;

  private handlers = new Map<
    string,
    {
      resolve: (val: Record<string, unknown>) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(
    command: string,
    args: string[] = [],
    env: Record<string, string> = {},
    timeout = 30,
  ) {
    this.command = command;
    this.args = args || [];
    this.env = env || {};
    this.timeout = timeout || 30;
  }

  public async request(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    await this.ensureStarted();
    await this.ensureInitialized();
    return this.requestRaw(method, params);
  }

  public async notify(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<void> {
    await this.ensureStarted();
    this.notifyRaw(method, params);
  }

  public close(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.process) {
      try {
        this.process.stdin?.end();
      } catch (_e) {}
      try {
        this.process.kill('SIGTERM');
      } catch (_e) {}
      this.process = null;
    }
    this.cleanup(new Error('MCP client closed'));
  }

  private async ensureStarted(): Promise<void> {
    if (this.process) return;

    const spawnEnv = { ...process.env, ...this.env };
    this.process = spawn(this.command, this.args, {
      env: spawnEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!this.process.stdout) {
      throw new Error('Failed to spawn MCP process: stdout is null');
    }

    this.rl = readline.createInterface({
      input: this.process.stdout,
      terminal: false,
    });

    this.rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line);
        this.handleMessage(msg);
      } catch (_e) {}
    });

    this.process.on('close', (code) => {
      this.cleanup(new Error(`MCP server closed with code ${code}`));
    });

    this.process.on('error', (err) => {
      this.cleanup(err);
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const version = VERSION;
    try {
      const resp = await this.requestRaw('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'aura', version },
      });
      if (resp?.result) {
        this.notifyRaw('notifications/initialized', {});
      }
    } catch (e) {
      this.initialized = false;
      throw e;
    }
  }

  private requestRaw(
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
          reject(new Error('mcp timeout'));
        }
      }, this.timeout * 1000);

      this.handlers.set(id, { resolve, reject, timer });
      this.writeMessage(payload);
    });
  }

  private notifyRaw(method: string, params?: Record<string, unknown>): void {
    const payload = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.writeMessage(payload);
  }

  private writeMessage(payload: Record<string, unknown>): void {
    if (!this.process?.stdin) return;
    try {
      this.process.stdin.write(`${JSON.stringify(payload)}
`);
    } catch (_e) {}
  }

  private handleMessage(msg: Record<string, unknown>): void {
    if (msg && msg.id !== undefined && msg.id !== null) {
      const id = String(msg.id);
      const handler = this.handlers.get(id);
      if (handler) {
        clearTimeout(handler.timer);
        this.handlers.delete(id);
        handler.resolve(msg);
      }
    }
  }

  private cleanup(err: Error): void {
    for (const [_id, handler] of this.handlers.entries()) {
      clearTimeout(handler.timer);
      handler.reject(err);
    }
    this.handlers.clear();
    this.process = null;
    this.initialized = false;
    this.rl = null;
  }
}

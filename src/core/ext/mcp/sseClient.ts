import { VERSION } from '../../../utils/version.js';

export class SseClient {
  private url: string;
  private headers: Record<string, string>;
  private timeout: number;
  private nextId = 1;
  private initialized = false;

  private running = false;
  private abort: AbortController | null = null;
  private listenPromise: Promise<void> | null = null;

  private handlers = new Map<
    string,
    {
      resolve: (val: Record<string, unknown>) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(url: string, headers: Record<string, string> = {}, timeout = 30) {
    this.url = String(url);
    this.headers = headers || {};
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
    await this.postMessage({ jsonrpc: '2.0', method, params });
  }

  public close(): void {
    this.running = false;
    try {
      this.abort?.abort();
    } catch (_e) {}
    this.abort = null;
    this.cleanup(new Error('MCP client closed'));
  }

  private async ensureStarted(): Promise<void> {
    if (this.running && this.listenPromise) return;

    this.running = true;
    this.abort = new AbortController();
    this.listenPromise = this.listenLoop(this.abort.signal).catch((err) => {
      this.cleanup(err instanceof Error ? err : new Error(String(err)));
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
        await this.postMessage({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {},
        });
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
      const payload = { jsonrpc: '2.0', id, method, params };

      const timer = setTimeout(() => {
        const handler = this.handlers.get(id);
        if (handler) {
          this.handlers.delete(id);
          reject(new Error('mcp sse timeout'));
        }
      }, this.timeout * 1000);

      this.handlers.set(id, { resolve, reject, timer });

      this.postMessage(payload).catch((err) => {
        clearTimeout(timer);
        this.handlers.delete(id);
        reject(err);
      });
    });
  }

  private async postMessage(payload: Record<string, unknown>): Promise<void> {
    const headers: Record<string, string> = {
      ...this.headers,
      'Content-Type': 'application/json',
    };
    await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  }

  private async listenLoop(signal: AbortSignal): Promise<void> {
    const headers: Record<string, string> = {
      ...this.headers,
      Accept: 'text/event-stream',
    };
    const resp = await fetch(this.url, { method: 'GET', headers, signal });
    if (!resp.ok || !resp.body) {
      throw new Error(`mcp sse connect failed: ${resp.status}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (this.running) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const raw of lines) {
        if (!this.running) break;
        const line = raw.trim();
        if (!line) continue;
        if (!line.startsWith('data:')) continue;
        const data = line.slice('data:'.length).trim();
        if (!data) continue;
        try {
          const msg = JSON.parse(data);
          this.handleMessage(msg);
        } catch (_e) {}
      }
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    if (!msg || msg.id === undefined || msg.id === null) return;
    const id = String(msg.id);
    const handler = this.handlers.get(id);
    if (!handler) return;
    clearTimeout(handler.timer);
    this.handlers.delete(id);
    handler.resolve(msg);
  }

  private cleanup(err: Error): void {
    for (const [_, handler] of this.handlers.entries()) {
      clearTimeout(handler.timer);
      handler.reject(err);
    }
    this.handlers.clear();
    this.running = false;
    this.listenPromise = null;
    this.initialized = false;
    this.abort = null;
  }
}

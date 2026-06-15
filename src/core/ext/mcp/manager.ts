import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { VERSION } from '../../../utils/version.js';
import type { ToolResult } from '../../kernel/interfaces.js';
import { StdioClient } from './client.js';
import { SseClient } from './sseClient.js';

export interface MCPConfigServer {
  name: string;
  transport?: 'stdio' | 'sse';
  timeout?: number;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  auto_load?: boolean;
  hint?: string;
  tool_hints?: Record<string, string>;
}

export interface MCPTool {
  name: string;
  tool: string;
  server: string;
  description: string;
  input_schema: Record<string, unknown>;
  auto_load: boolean;
  hint: string;
  raw: any;
}

type MCPClient = {
  request: (method: string, params?: any) => Promise<any>;
  notify: (method: string, params?: any) => Promise<void>;
  close: () => void;
};

export class MCPManager {
  private projectPath: string;
  private clients: Record<string, MCPClient> = {};

  constructor(projectPath: string) {
    this.projectPath = path.resolve(projectPath);
  }

  public shutdown(): void {
    for (const client of Object.values(this.clients)) {
      try {
        client.close();
      } catch (_e) {}
    }
    this.clients = {};
  }

  public mcpTool(name: string): boolean {
    return String(name).startsWith('mcp.');
  }

  public listTools(): MCPTool[] {
    const srvs = this.servers();
    const toolsList: MCPTool[] = [];

    for (const srv of srvs) {
      const name = srv.name;
      if (!name) continue;

      const transport = srv.transport || 'stdio';
      const timeout = srv.timeout || 30;

      if (transport === 'stdio') {
        const cmd = srv.command;
        if (!cmd) continue;

        const args = srv.args || [];
        const env = srv.env || {};

        try {
          const input = [
            {
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2025-11-25',
                capabilities: {},
                clientInfo: { name: 'aura-helper', version: VERSION },
              },
            },
            {
              jsonrpc: '2.0',
              method: 'notifications/initialized',
              params: {},
            },
            {
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/list',
              params: {},
            },
          ]
            .map((msg) => JSON.stringify(msg))
            .join('\n');

          const res = spawnSync(cmd, args, {
            encoding: 'utf-8',
            env: { ...process.env, ...env },
            input: `${input}\n`,
            timeout: timeout * 1000,
          });

          if (res.stdout.trim()) {
            const resp = res.stdout
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => {
                try {
                  return JSON.parse(line);
                } catch (_e) {
                  return null;
                }
              })
              .find((msg) => String(msg?.id) === '2');
            if (!resp) continue;
            const tools = resp.result?.tools || [];
            for (const t of tools) {
              const toolHint = this.buildHint(srv, t.name);
              toolsList.push({
                name: `mcp.${name}.${t.name}`,
                tool: t.name,
                server: name,
                description: t.description || t.title || '',
                input_schema: t.inputSchema || t.input_schema || t.input || {},
                auto_load: srv.auto_load !== false,
                hint: toolHint || 'No specific guidance provided.',
                raw: t,
              });
            }
          }
        } catch (_e) {}
        continue;
      }

      if (transport === 'sse') {
        const url = srv.url;
        if (!url) continue;
        const headers = srv.headers || {};

        const helperScript = `
const url = process.argv[1];
const headers = JSON.parse(process.argv[2] || '{}');
const timeout = parseInt(process.argv[3], 10) || 30;

let step = 'init';

const ac = new AbortController();
const timer = setTimeout(() => {
  try { ac.abort(); } catch (e) {}
  process.exit(1);
}, timeout * 1000);

const post = async (payload) => {
  await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

const handleLine = async (line) => {
  if (!line) return;
  if (!line.startsWith('data:')) return;
  const data = line.slice('data:'.length).trim();
  if (!data) return;
  let msg = null;
  try { msg = JSON.parse(data); } catch (e) { return; }
  if (!msg || msg.id === undefined || msg.id === null) return;

  if (step === 'init' && String(msg.id) === '1') {
    step = 'list';
    await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    await post({ jsonrpc: '2.0', id: '2', method: 'tools/list', params: {} });
  } else if (step === 'list' && String(msg.id) === '2') {
    clearTimeout(timer);
    console.log(JSON.stringify(msg));
    try { ac.abort(); } catch (e) {}
    process.exit(0);
  }
};

(async () => {
  const resp = await fetch(url, {
    method: 'GET',
    headers: { ...headers, Accept: 'text/event-stream' },
    signal: ac.signal,
  });
  if (!resp.ok || !resp.body) process.exit(1);

  await post({
    jsonrpc: '2.0',
    id: '1',
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'aura-helper', version: '${VERSION}' }
    }
  });

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\\n');
    buffer = lines.pop() || '';
    for (const raw of lines) {
      await handleLine(raw.trim());
    }
  }
  process.exit(1);
})().catch(() => process.exit(1));
`;

        try {
          const res = spawnSync(
            process.execPath,
            [
              '-e',
              helperScript,
              String(url),
              JSON.stringify(headers),
              String(timeout),
            ],
            {
              encoding: 'utf-8',
              timeout: (timeout + 2) * 1000,
            },
          );

          if (res.status === 0 && res.stdout.trim()) {
            const resp = JSON.parse(res.stdout.trim());
            const tools = resp.result?.tools || [];
            for (const t of tools) {
              const toolHint = this.buildHint(srv, t.name);
              toolsList.push({
                name: `mcp.${name}.${t.name}`,
                tool: t.name,
                server: name,
                description: t.description || t.title || '',
                input_schema: t.inputSchema || t.input_schema || t.input || {},
                auto_load: srv.auto_load !== false,
                hint: toolHint || 'No specific guidance provided.',
                raw: t,
              });
            }
          }
        } catch (_e) {}
      }
    }

    return toolsList;
  }

  public async callTool(
    fullName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const parsed = this.parseTool(fullName);
    if (!parsed) {
      return { status: 'failed', error: `invalid mcp tool: ${fullName}` };
    }
    const [server, tool] = parsed;

    const srvs = this.servers();
    const srv = srvs.find((s) => s.name === server);
    if (!srv) {
      return { status: 'failed', error: `mcp server not found: ${server}` };
    }

    const client = this.clientFor(srv);
    if (!client) {
      return { status: 'failed', error: `mcp server unavailable: ${server}` };
    }

    try {
      const resp = await client.request('tools/call', {
        name: tool,
        arguments: args || {},
      });
      if (resp?.error) {
        return { status: 'failed', error: resp.error.message || resp.error };
      }

      const res = resp.result || {};
      const text = this.extractText(res.content);
      const status = res.isError ? 'failed' : 'ok';
      const out: ToolResult = {
        status,
        content: text || res.content,
        mcp: res,
      };
      if (res.isError) {
        out.error = res.content;
      }
      return out;
    } catch (e: unknown) {
      const msg = (e as Error).message ?? String(e);
      return { status: 'failed', error: msg };
    }
  }

  private servers(): MCPConfigServer[] {
    const configPath = path.join(
      this.projectPath,
      'tools',
      'mcp',
      'config.yml',
    );
    if (!fs.existsSync(configPath)) {
      return [];
    }
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const cfg = yaml.parse(content) || {};
      return Array.isArray(cfg.servers) ? cfg.servers : [];
    } catch (_e) {
      return [];
    }
  }

  private clientFor(serverCfg: MCPConfigServer): MCPClient | null {
    const transport = String(serverCfg.transport || 'stdio');
    const name = String(serverCfg.name || '');
    if (!name) return null;

    if (this.clients[name]) {
      return this.clients[name];
    }

    if (transport === 'stdio') {
      const cmd = serverCfg.command;
      if (!cmd) return null;
      const args = serverCfg.args || [];
      const env = serverCfg.env || {};
      const timeout = serverCfg.timeout || 30;

      const client = new StdioClient(cmd, args, env, timeout);
      this.clients[name] = client;
      return client;
    }

    if (transport === 'sse') {
      const url = serverCfg.url;
      if (!url) return null;
      const headers = serverCfg.headers || {};
      const timeout = serverCfg.timeout || 30;

      const client = new SseClient(url, headers, timeout);
      this.clients[name] = client;
      return client;
    }

    return null;
  }

  private parseTool(name: string): [string, string] | null {
    const parts = String(name).split('.');
    if (parts.length < 3 || parts[0] !== 'mcp') {
      return null;
    }
    const server = parts[1];
    const tool = parts.slice(2).join('.');
    return [server, tool];
  }

  private extractText(content: Record<string, unknown>[]): string | null {
    if (!Array.isArray(content)) {
      return null;
    }
    const texts = content
      .map((c) => {
        if (c && typeof c === 'object' && c.type === 'text') {
          return c.text;
        }
        return null;
      })
      .filter((t) => t !== null);

    if (texts.length === 0) {
      return null;
    }
    return texts.join('\n');
  }

  private buildHint(
    serverCfg: MCPConfigServer,
    toolName: string,
  ): string | null {
    const base = serverCfg.hint || '';
    const toolHints = serverCfg.tool_hints || {};
    const toolHint = toolHints[toolName] || '';
    const hints = [base, toolHint].map((h) => String(h).trim()).filter(Boolean);
    if (hints.length === 0) return null;
    return hints.join('\n');
  }
}

import path from 'node:path';
import { LSPClient } from './client.js';

export interface LSPDiagnostic {
  severity: number;
  message: string;
  range: {
    start: { line: number; character: number };
    end?: { line: number; character: number };
  };
  source?: string;
  code?: string | number;
}

export interface LSPPublishDiagnosticsParams {
  uri: string;
  diagnostics: LSPDiagnostic[];
}

export class LSPManager {
  private projectPath: string;
  private diagnostics: Record<string, LSPDiagnostic[]> = {};
  private clients: Record<string, LSPClient> = {};

  constructor(projectPath: string) {
    this.projectPath = path.resolve(projectPath);
  }

  public async clientFor(language: string): Promise<LSPClient | null> {
    if (this.clients[language]) {
      return this.clients[language];
    }
    const client = await this.startClient(language);
    if (client) {
      this.clients[language] = client;
    }
    return client;
  }

  public getDiagnostics(
    filePath?: string,
  ): Record<string, LSPDiagnostic[]> | LSPDiagnostic[] {
    if (filePath) {
      const uri = `file://${path.resolve(this.projectPath, filePath).replace(/\\/g, '/')}`;
      return this.diagnostics[uri] || [];
    }
    return this.diagnostics;
  }

  public stopAll(): void {
    for (const client of Object.values(this.clients)) {
      try {
        client.stop();
      } catch (_e) {}
    }
    this.clients = {};
  }

  private async startClient(language: string): Promise<LSPClient | null> {
    const config = this.lspConfigs()[language];
    if (!config) return null;

    const client = new LSPClient(config.command, config.args, config.env || {});
    client.onNotification(
      'textDocument/publishDiagnostics',
      (params: LSPPublishDiagnosticsParams) => {
        this.updateDiagnostics(params);
      },
    );

    try {
      await client.initializeServer(this.projectPath);
      return client;
    } catch (_e) {
      return null;
    }
  }

  public updateDiagnostics(params: LSPPublishDiagnosticsParams): void {
    const uri = params.uri;
    const diags = params.diagnostics || [];
    this.diagnostics[uri] = diags;
  }

  private lspConfigs(): Record<
    string,
    { command: string; args: string[]; env?: Record<string, string> }
  > {
    return {
      ruby: {
        command: 'solargraph',
        args: ['stdio'],
        env: { PATH: process.env.PATH || '' },
      },
      python: {
        command: 'pyright-langserver',
        args: ['--stdio'],
        env: { PATH: process.env.PATH || '' },
      },
    };
  }
}

import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import { loadTyped } from '../../utils/configManager.js';
import { type AuraConfig, parseAuraConfig } from '../../utils/configSchema.js';
import * as PathResolver from '../../utils/pathResolver.js';
import type { LSPManager } from '../ext/lsp/manager.js';
import { MCPManager } from '../ext/mcp/manager.js';
import { GitState } from './gitState.js';
import type { ToolResult } from './interfaces.js';
import { ToolRegistry } from './registry.js';
import { ShadowBackup } from './shadowBackup.js';

export interface ExecutionOptions {
  /** If provided, overrides process.env.AURA_STATE_DB_PATH for this execution only */
  sessionDbPath?: string;
  /** If provided, overrides process.env.AURA_SESSION_NAME for this execution only */
  sessionName?: string;
}

export class ExecutionEngine {
  private projectPath: string;
  private envPath: string;
  private registry: ToolRegistry;
  private mcpManager: MCPManager;
  private lspManager?: LSPManager;
  private shadowBackup: ShadowBackup;
  private gitState: GitState;

  constructor(
    projectPath: string,
    options: { envPath?: string; lsp_manager?: LSPManager } = {},
  ) {
    this.projectPath = path.resolve(projectPath);
    this.envPath =
      options.envPath ||
      PathResolver.environmentPath(this.projectPath) ||
      this.projectPath;
    this.registry = new ToolRegistry(this.envPath);
    this.mcpManager = new MCPManager(this.envPath);
    this.lspManager = options.lsp_manager;

    this.shadowBackup = new ShadowBackup(this.projectPath);
    this.gitState = new GitState(this.projectPath);
  }

  public async execute(
    toolName: string,
    args: Record<string, unknown>,
    options: ExecutionOptions = {},
  ): Promise<ToolResult> {
    return this.executeRaw(toolName, args, options);
  }

  public async executeRaw(
    toolName: string,
    args: Record<string, unknown>,
    options: ExecutionOptions = {},
  ): Promise<ToolResult> {
    const cfg = this.loadFullConfig(options.sessionDbPath);
    const cleanArgs: Record<string, unknown> = { ...(args || {}) };

    // Resolve timeouts
    const defaultTimeout = cfg.tool_protocol?.default_timeout_seconds ?? 300;
    const maxTimeout = cfg.tool_protocol?.max_timeout_seconds ?? 1200;
    const configAgentCanModify =
      cfg.tool_protocol?.agent_can_modify_timeout !== false;

    const toolData = this.registry.find(toolName);
    const manifest = toolData ? toolData.manifest || {} : {};

    const agentCanModify =
      manifest.agent_can_modify_timeout ?? configAgentCanModify;
    const baseTimeout = manifest.timeout ?? defaultTimeout;

    const argsTimeout = cleanArgs.timeout_seconds ?? cleanArgs.timeout;
    let resolvedTimeout =
      argsTimeout !== undefined && agentCanModify
        ? Number(argsTimeout)
        : Number(baseTimeout);

    resolvedTimeout = Math.min(resolvedTimeout, Number(maxTimeout)) * 1000; // convert to ms

    // Dispatching MCP tools
    if (this.mcpManager.mcpTool(toolName)) {
      return this.executeWithTimeout(resolvedTimeout, async () => {
        return this.mcpManager.callTool(toolName, cleanArgs);
      });
    }

    // Dispatching LSP tools
    if (toolName === 'lsp_diagnostics') {
      return this.executeWithTimeout(resolvedTimeout, async () => {
        if (!this.lspManager) {
          return {
            error: 'LSP manager not configured',
            status: 'failed' as const,
          };
        }
        try {
          const file = (cleanArgs.file_path || cleanArgs.path) as
            | string
            | undefined;
          const diagnostics = this.lspManager.getDiagnostics(file);
          return { status: 'ok' as const, diagnostics };
        } catch (e: unknown) {
          return { error: (e as Error).message, status: 'failed' as const };
        }
      }) as Promise<ToolResult>;
    }

    if (!toolData) {
      return {
        error: `tool not found in registry: ${toolName}`,
        status: 'failed',
      };
    }

    const dir = toolData.path;
    const runtimeData = manifest.runtime;
    const runtimeKey =
      typeof runtimeData === 'object'
        ? (runtimeData.language ?? runtimeData.runtime)
        : runtimeData;
    const runtime = this.resolveRuntime(runtimeKey, cfg);
    const entry =
      manifest.entry ??
      (typeof runtimeData === 'object' ? runtimeData.entry_point : null) ??
      'logic.py';
    const logic = path.join(dir, entry);

    if (!fs.existsSync(logic)) {
      return { error: `entry not found: ${entry}`, status: 'failed' };
    }

    // Strict path checks
    const strict = !!cfg.security?.strict_path_isolation;
    if (cleanArgs.strict_mode === undefined) {
      cleanArgs.strict_mode = strict;
    }

    const contextPermissions = (cleanArgs.context_permissions ||
      []) as string[];
    if (strict) {
      const perms = ['.', ...contextPermissions];
      perms.push('./knowledge', './tools', 'AURA_README.md');
      cleanArgs.context_permissions = Array.from(
        new Set(perms.filter(Boolean)),
      );
      cleanArgs.forbidden_extensions =
        cleanArgs.forbidden_extensions ||
        cfg.security?.forbidden_extensions ||
        [];
      cleanArgs.read_only_directories =
        cleanArgs.read_only_directories ||
        cfg.security?.read_only_directories ||
        [];
    }

    const allowed = (manifest.permissions?.allow_paths || []) as string[];
    if (allowed && allowed.length > 0) {
      const perms = (cleanArgs.context_permissions || []) as string[];
      perms.push(...allowed);
      cleanArgs.context_permissions = Array.from(
        new Set(perms.filter(Boolean)),
      );
    }

    // Default truncation / bash commands limits
    try {
      const callOut = cfg.tool_protocol?.call_output || {};
      if (callOut.max_chars)
        cleanArgs.max_output_chars =
          cleanArgs.max_output_chars ?? callOut.max_chars;
      if (callOut.head_ratio)
        cleanArgs.head_ratio = cleanArgs.head_ratio ?? callOut.head_ratio;

      if (toolName === 'bash_command') {
        const bashCfg = cfg.tool_protocol?.bash || {};
        if (bashCfg.base_wait_seconds) {
          cleanArgs.timeout_seconds =
            cleanArgs.timeout_seconds ?? bashCfg.base_wait_seconds;
        }
      }
    } catch (_e) {}

    const payload = JSON.stringify(cleanArgs);
    const [cmd, finalArgs] = this.applySandbox(cfg, runtime, logic, payload);

    try {
      const execPromise = execa(cmd[0], [...cmd.slice(1), ...finalArgs], {
        input: payload,
        cwd: this.projectPath,
        timeout: resolvedTimeout + 2000,
        reject: false,
        env: {
          ...process.env,
          ...(options.sessionDbPath
            ? { AURA_STATE_DB_PATH: options.sessionDbPath }
            : {}),
          ...(options.sessionName
            ? { AURA_SESSION_NAME: options.sessionName }
            : {}),
        },
      });

      const { stdout, stderr, exitCode, timedOut } = await execPromise;

      if (timedOut) {
        return {
          error: `Tool execution timed out after ${resolvedTimeout / 1000} seconds.`,
          status: 'failed',
        };
      }

      const body = stderr.trim()
        ? `${stdout}
${stderr}`.trim()
        : stdout.trim();

      if (exitCode === 0) {
        const obj = this.parseJsonSafe(body);
        obj.status = (obj.status as string) || 'ok';

        // Shadow backup
        try {
          await this.shadowBackup.recordChanges(toolName, cleanArgs);
        } catch (e: unknown) {
          console.warn(
            `[ExecutionEngine] Shadow backup failed for ${toolName}: ${(e as Error).message}`,
          );
        }

        // Git Snapshot
        if (cfg.security?.git_snapshots) {
          await this.gitState.snapshot(toolName, true);
        }

        return obj as ToolResult;
      } else {
        return {
          error: body || `process exited with code ${exitCode}`,
          status: 'failed' as const,
        };
      }
    } catch (e: unknown) {
      if ((e as { timedOut?: boolean }).timedOut) {
        return {
          error: `Tool execution timed out after ${resolvedTimeout / 1000} seconds.`,
          status: 'failed' as const,
        };
      }
      return { error: (e as Error).message, status: 'failed' as const };
    }
  }

  private async executeWithTimeout<T>(
    ms: number,
    fn: () => Promise<T>,
  ): Promise<T | { error: string; status: 'failed' }> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(`Tool execution timed out after ${ms / 1000} seconds.`),
          ),
        ms,
      );
    });
    try {
      return await Promise.race([fn(), timeout]);
    } catch (e: unknown) {
      return { error: (e as Error).message, status: 'failed' };
    }
  }

  private resolveRuntime(key: unknown, cfg: AuraConfig): string {
    const runtimeKey = String(key || 'python');
    let resolved =
      (cfg?.tool_protocol?.runtimes as Record<string, string>)?.[runtimeKey] ||
      runtimeKey;
    if (resolved === 'python3') {
      resolved = 'python';
    }
    return resolved;
  }

  private parseJsonSafe(s: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === 'object' ? parsed : { output: s };
    } catch {
      return { output: s };
    }
  }

  private loadFullConfig(sessionDbPath?: string): AuraConfig {
    // Temporarily scope AURA_STATE_DB_PATH for Python tools that read it
    const prevDbPath = process.env.AURA_STATE_DB_PATH;
    if (sessionDbPath) {
      process.env.AURA_STATE_DB_PATH = sessionDbPath;
    }
    try {
      return loadTyped(this.envPath);
    } catch {
      return parseAuraConfig({});
    } finally {
      if (sessionDbPath !== undefined) {
        if (prevDbPath === undefined) {
          delete process.env.AURA_STATE_DB_PATH;
        } else {
          process.env.AURA_STATE_DB_PATH = prevDbPath;
        }
      }
    }
  }

  private applySandbox(
    cfg: AuraConfig,
    runtime: string,
    logic: string,
    _payload: string,
  ): [string[], string[]] {
    const sandbox = cfg.security?.sandbox;
    if (!sandbox?.enabled) {
      return [[runtime, logic], []];
    }

    if (sandbox.provider === 'docker') {
      const image = sandbox.image || 'aura-sandbox:latest';
      return [
        [
          'docker',
          'run',
          '--rm',
          '-i',
          '-v',
          `${this.projectPath}:/app`,
          '-w',
          '/app',
          image,
          runtime,
          logic,
        ],
        [],
      ];
    }

    if (sandbox.provider === 'local') {
      const wrapper = path.join(this.envPath, 'bin', 'sandbox-wrapper');
      if (fs.existsSync(wrapper)) {
        return [[wrapper, runtime, logic], []];
      }
    }

    return [[runtime, logic], []];
  }
}

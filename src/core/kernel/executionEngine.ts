import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import { loadTyped } from '../../utils/configManager.js';
import { type AuraConfig, parseAuraConfig } from '../../utils/configSchema.js';
import { readLastLinesSync } from '../../utils/fsUtils.js';
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

export class ExecutionEngine extends EventEmitter {
  private projectPath: string;
  private envPath: string;
  private registry: ToolRegistry;
  private mcpManager: MCPManager;
  private lspManager?: LSPManager;
  private shadowBackup: ShadowBackup;
  private gitState: GitState;
  /** Active PTY processes keyed by PID (populated when background:true + pty:true). */
  private ptyProcesses = new Map<number, import('node:stream').Writable>();
  private ptyStates = new Map<number, { resetPromptPending: () => void }>();

  constructor(
    projectPath: string,
    options: { envPath?: string; lsp_manager?: LSPManager } = {},
  ) {
    super();
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

    if (Number.isNaN(resolvedTimeout) || resolvedTimeout <= 0) {
      resolvedTimeout = Number(baseTimeout);
    }
    if (Number.isNaN(resolvedTimeout) || resolvedTimeout <= 0) {
      resolvedTimeout = 300;
    }

    let finalMaxTimeout = Number(maxTimeout);
    if (Number.isNaN(finalMaxTimeout) || finalMaxTimeout <= 0) {
      finalMaxTimeout = 1200;
    }

    resolvedTimeout = Math.min(resolvedTimeout, finalMaxTimeout) * 1000; // convert to ms

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
          return {
            error: e instanceof Error ? e.message : String(e),
            status: 'failed' as const,
          };
        }
      }) as Promise<ToolResult>;
    }

    // Dispatching wait_for_process
    if (toolName === 'wait_for_process') {
      return this.executeWithTimeout(resolvedTimeout, async () => {
        const pid = Number(cleanArgs.pid);
        if (Number.isNaN(pid)) {
          return {
            status: 'failed',
            error: 'Invalid or missing "pid" parameter.',
          };
        }
        const timeoutSeconds = Number(cleanArgs.timeout_seconds ?? 30);
        const startTime = Date.now();
        const commandsDir = path.join(this.envPath, 'state', 'commands');

        let tick = 0;
        while (true) {
          let isAlive = false;
          try {
            process.kill(pid, 0);
            isAlive = true;
          } catch (err: any) {
            isAlive = err.code === 'EPERM';
          }

          if (isAlive && tick % 10 === 0) {
            const metadataPath = path.join(commandsDir, `${pid}.json`);
            if (fs.existsSync(metadataPath)) {
              try {
                const raw = fs.readFileSync(metadataPath, 'utf-8');
                const meta = JSON.parse(raw);
                if (meta.process_start_time) {
                  const { stdout: psOut } = await execa('ps', ['-p', String(pid), '-o', 'lstart=']);
                  const currentStartTime = psOut.trim();
                  if (currentStartTime !== meta.process_start_time) {
                    isAlive = false;
                  }
                }
              } catch {}
            }
          }

          if (!isAlive) {
            // Give a tiny window (50ms) for the exit event handler to run and update the status file
            await new Promise((resolve) => setTimeout(resolve, 50));

            let status = 'finished';
            let exitCode: number | null = null;
            let stdoutFile: string | undefined;
            const metadataPath = path.join(commandsDir, `${pid}.json`);
            if (fs.existsSync(metadataPath)) {
              try {
                const raw = fs.readFileSync(metadataPath, 'utf-8');
                const meta = JSON.parse(raw);
                if (meta.status === 'running') {
                  meta.status = 'finished';
                  meta.ended_at = Date.now() / 1000;
                  fs.writeFileSync(
                    metadataPath,
                    JSON.stringify(meta, null, 2),
                    'utf-8',
                  );
                }
                status = meta.status || 'finished';
                exitCode = meta.exit_code ?? null;
                stdoutFile = meta.stdout_file;
              } catch {}
            }

            const outPath = stdoutFile || path.join(commandsDir, `${pid}.out`);
            if (fs.existsSync(outPath)) {
              try {
                const stdout = readLastLinesSync(outPath, 10).trim();
                const cleanStdout = stdout.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
                const lines = cleanStdout.split('\n').filter(Boolean);
                for (let i = lines.length - 1; i >= 0; i--) {
                  const line = lines[i].trim();
                  if (line.startsWith('{') && line.endsWith('}')) {
                    try {
                      const result = JSON.parse(line);
                      if (result && typeof result === 'object') {
                        return result;
                      }
                    } catch {}
                  }
                  const startIdx = line.lastIndexOf('{');
                  const endIdx = line.lastIndexOf('}');
                  if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
                    try {
                      const jsonSub = line.substring(startIdx, endIdx + 1);
                      const result = JSON.parse(jsonSub);
                      if (result && typeof result === 'object') {
                        return result;
                      }
                    } catch {}
                  }
                }
              } catch {}
            }

            if (status === 'failed') {
              return {
                status: 'failed',
                error: `Process exited with error (exit code: ${exitCode ?? 'unknown'}).`,
              };
            }
            return { status: 'ok', output: 'Process exited.' };
          }

          if (Date.now() - startTime >= timeoutSeconds * 1000) {
            return {
              status: 'running',
              pid,
              message: 'Process is still running.',
            };
          }

          await new Promise((resolve) => setTimeout(resolve, 500));
          tick++;
        }
      }) as Promise<ToolResult>;
    }

    // Dispatching sleep_and_wake
    if (toolName === 'sleep_and_wake') {
      const rawSeconds = Number(cleanArgs.seconds ?? 0);
      const MAX_SLEEP_SECONDS = 3600;
      const clampedSeconds = Math.max(
        0,
        Math.min(rawSeconds, MAX_SLEEP_SECONDS),
      );
      if (Number.isNaN(clampedSeconds) || clampedSeconds === 0) {
        return {
          status: 'failed',
          error:
            'Invalid or missing "seconds" parameter (must be > 0, max 3600).',
        };
      }
      const reason =
        typeof cleanArgs.reason === 'string' ? cleanArgs.reason : null;
      const wakeAt = new Date(Date.now() + clampedSeconds * 1000).toISOString();
      const abortSignal = cleanArgs.__abortSignal__ as AbortSignal | undefined;

      // Race sleep against an optional abort signal so socket disconnects cancel the sleep.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          cleanup();
          resolve();
        }, clampedSeconds * 1000);

        let onAbort: (() => void) | undefined;
        if (abortSignal) {
          onAbort = () => {
            clearTimeout(timer);
            cleanup();
            resolve();
          };
          abortSignal.addEventListener('abort', onAbort, { once: true });
        }

        function cleanup() {
          if (abortSignal && onAbort) {
            abortSignal.removeEventListener('abort', onAbort);
          }
        }
      });

      // If aborted mid-sleep, surface a clear error instead of resuming the loop.
      if (abortSignal?.aborted) {
        throw new Error('Sleep interrupted: client disconnected');
      }

      return {
        status: 'sleeping' as const,
        slept_seconds: clampedSeconds,
        wake_at: wakeAt,
        reason,
        message: `Slept for ${clampedSeconds} seconds. Resuming with fresh context.`,
      };
    }

    // Dispatching send_process_input
    if (toolName === 'send_process_input') {
      const pid = Number(cleanArgs.pid);
      if (Number.isNaN(pid)) {
        return {
          status: 'failed',
          error: 'Invalid or missing "pid" parameter.',
        };
      }
      const input =
        typeof cleanArgs.input === 'string' ? cleanArgs.input : null;
      if (input === null) {
        return {
          status: 'failed',
          error: 'Missing required "input" parameter.',
        };
      }
      const ptyStdin = this.ptyProcesses.get(pid);
      if (!ptyStdin) {
        return {
          status: 'failed',
          error: `No active PTY process found for PID ${pid}. Only processes started with background:true and pty:true support interactive input.`,
        };
      }
      const normalizedInput = input.replace(/[\r\n]+$/, '');
      try {
        const ptyState = this.ptyStates.get(pid);
        if (ptyState) {
          ptyState.resetPromptPending();
        }
        // node-pty uses write(), plain Writable streams also use write()
        (ptyStdin as any).write(`${normalizedInput}\r`);
        return { status: 'ok', message: `Input sent to process ${pid}.` };
      } catch (e: unknown) {
        return {
          status: 'failed',
          error: `Failed to write to process stdin: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
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
    const [cmd, finalArgs] = this.applySandbox(
      cfg,
      runtime,
      logic,
      payload,
      options,
    );

    const isBackground = cleanArgs.background === true;
    const isPty = isBackground && cleanArgs.pty === true;

    if (isBackground) {
      const commandsDir = path.join(this.envPath, 'state', 'commands');
      if (!fs.existsSync(commandsDir)) {
        fs.mkdirSync(commandsDir, { recursive: true });
      }

      const taskTag = `task-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const outPath = path.join(commandsDir, `${taskTag}.out`);
      const errPath = path.join(commandsDir, `${taskTag}.err`);

      if (isPty) {
        // ── PTY path: interactive background process ─────────────────────
        const ptyModule = await import('node-pty');
        const allArgs = [...cmd.slice(1), ...finalArgs];
        const ptyProcess = ptyModule.spawn(cmd[0], allArgs, {
          name: 'xterm-256color',
          cols: 220,
          rows: 50,
          cwd: this.projectPath,
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
        // Write JSON payload as first stdin line (same contract as non-PTY)
        ptyProcess.write(`${payload}\r`);

        const outStream = fs.createWriteStream(outPath, { flags: 'a' });
        outStream.on('error', (err) => {
          console.error(
            `[ExecutionEngine] PTY outStream error for PID ${ptyProcess.pid}:`,
            err,
          );
        });

        const PROMPT_PATTERNS = [
          /\[y\/n\]\s*$/i,
          /\(yes\/no\)\s*$/i,
          /\[Y\/n\]\s*$/,
          /\(y\/N\)\s*$/,
          /password[:\s]*$/i,
          /passphrase[:\s]*$/i,
          /enter\s+.+:\s*$/i,
          /confirm[:\s]*$/i,
          // Deliberately omit bare /> \s*$/ — too many false positives from
          // shell prompts in normal output. Only match prompt-like ? at line end.
          /[^\w]\?\s*$/,
        ];

        let silenceTimer: NodeJS.Timeout | null = null;
        let recentOutput = '';
        let promptPending = false; // guard: don't spam duplicate events
        const SILENCE_MS = 5000;

        const resetSilenceTimer = (pid: number) => {
          if (silenceTimer) clearTimeout(silenceTimer);
          silenceTimer = setTimeout(() => {
            if (recentOutput.trim() && !promptPending) {
              promptPending = true;
              this.emit('interactive_prompt', {
                pid,
                prompt: recentOutput.slice(-512),
                trigger: 'silence_timeout',
              });
            }
          }, SILENCE_MS);
        };

        const pid = ptyProcess.pid;
        const jsonPath = path.join(commandsDir, `${pid}.json`);

        this.ptyStates.set(pid, {
          resetPromptPending: () => {
            promptPending = false;
            resetSilenceTimer(pid);
          },
        });

        ptyProcess.onData((data: string) => {
          outStream.write(data);
          recentOutput = (recentOutput + data).slice(-1024);
          // Any new output means the process is not stuck waiting — reset guard.
          promptPending = false;
          resetSilenceTimer(pid);
          for (const pattern of PROMPT_PATTERNS) {
            if (pattern.test(recentOutput) && !promptPending) {
              promptPending = true;
              if (silenceTimer) {
                clearTimeout(silenceTimer);
                silenceTimer = null;
              }
              this.emit('interactive_prompt', {
                pid,
                prompt: recentOutput.slice(-512),
                trigger: 'pattern_match',
              });
              break;
            }
          }
        });

        let processStartTime = '';
        try {
          const { stdout: psOut } = await execa('ps', ['-p', String(pid), '-o', 'lstart=']);
          processStartTime = psOut.trim();
        } catch {}

        const meta = {
          pid,
          command: `${toolName} ${JSON.stringify(cleanArgs)}`,
          cwd: this.projectPath,
          started_at: Date.now() / 1000,
          status: 'running',
          pty: true,
          process_start_time: processStartTime,
          // PTY merges stdout+stderr on the same master fd — only one output file.
          stdout_file: outPath,
        };
        fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2), 'utf-8');

        this.ptyProcesses.set(
          pid,
          ptyProcess as unknown as import('node:stream').Writable,
        );

        ptyProcess.onExit(
          ({ exitCode, signal }: { exitCode: number; signal?: number }) => {
            if (silenceTimer) {
              clearTimeout(silenceTimer);
              silenceTimer = null;
            }
            outStream.end();
            this.ptyProcesses.delete(pid);
            this.ptyStates.delete(pid);
            try {
              if (fs.existsSync(jsonPath)) {
                const raw = fs.readFileSync(jsonPath, 'utf-8');
                const m = JSON.parse(raw);
                m.status = exitCode === 0 ? 'finished' : 'failed';
                m.exit_code = exitCode ?? null;
                m.signal = signal ?? null;
                m.ended_at = Date.now() / 1000;
                fs.writeFileSync(jsonPath, JSON.stringify(m, null, 2), 'utf-8');
              }
            } catch {}
          },
        );

        return {
          status: 'running',
          pid,
          taskId: String(pid),
          pty: true,
          message:
            'PTY process started in background. Interactive stdin is supported via send_process_input.',
          stdout_file: outPath,
          stderr_file: errPath,
        };
      } else {
        // ── Regular detached spawn path ──────────────────────────────────
        const outStream = fs.openSync(outPath, 'a');
        const errStream = fs.openSync(errPath, 'a');

        const child = spawn(cmd[0], [...cmd.slice(1), ...finalArgs], {
          detached: true,
          stdio: ['pipe', outStream, errStream],
          cwd: this.projectPath,
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

        fs.closeSync(outStream);
        fs.closeSync(errStream);

        if (child.stdin) {
          child.stdin.write(payload);
          child.stdin.end();
        }
        child.unref();

        const pid = child.pid;
        if (!pid) {
          throw new Error('Failed to spawn background process');
        }

        let processStartTime = '';
        try {
          const { stdout: psOut } = await execa('ps', ['-p', String(pid), '-o', 'lstart=']);
          processStartTime = psOut.trim();
        } catch {}

        const meta = {
          pid,
          command: `${toolName} ${JSON.stringify(cleanArgs)}`,
          cwd: this.projectPath,
          started_at: Date.now() / 1000,
          status: 'running',
          process_start_time: processStartTime,
          stdout_file: outPath,
          stderr_file: errPath,
        };

        const jsonPath = path.join(commandsDir, `${pid}.json`);
        fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2), 'utf-8');

        child.on('exit', (code, signal) => {
          try {
            if (fs.existsSync(jsonPath)) {
              const raw = fs.readFileSync(jsonPath, 'utf-8');
              const currentMeta = JSON.parse(raw);
              currentMeta.status = code === 0 ? 'finished' : 'failed';
              currentMeta.exit_code = code ?? null;
              currentMeta.signal = signal ?? null;
              currentMeta.ended_at = Date.now() / 1000;
              fs.writeFileSync(
                jsonPath,
                JSON.stringify(currentMeta, null, 2),
                'utf-8',
              );
            }
          } catch {}
        });

        return {
          status: 'running',
          pid,
          taskId: String(pid),
          message: 'Process started in background.',
          stdout_file: outPath,
          stderr_file: errPath,
        };
      }
    }

    const maxOutputChars: number =
      (cfg.tool_protocol?.call_output as { max_chars?: number })?.max_chars ??
      8000;

    try {
      const execPromise = execa(cmd[0], [...cmd.slice(1), ...finalArgs], {
        input: payload,
        cwd: this.projectPath,
        timeout: resolvedTimeout + 2000,
        reject: false,
        // Bound in-memory buffering at the collection level before any
        // post-hoc truncation. 4x gives room for both streams.
        maxBuffer: maxOutputChars * 4,
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
        const partialOutput = this.mergeOutput(stdout, stderr, maxOutputChars);
        return {
          error: `Tool execution timed out after ${resolvedTimeout / 1000} seconds.`,
          status: 'failed',
          ...(partialOutput ? { output: partialOutput } : {}),
        };
      }

      // For successful / failed exits the tool script applies its own
      // max_output_chars internally, so we only merge streams here.
      const body = this.mergeOutput(stdout, stderr);

      if (exitCode === 0) {
        const obj = this.parseJsonSafe(body);
        obj.status = (obj.status as string) || 'ok';

        // Shadow backup
        try {
          await this.shadowBackup.recordChanges(toolName, cleanArgs);
        } catch (e: unknown) {
          console.warn(
            `[ExecutionEngine] Shadow backup failed for ${toolName}: ${e instanceof Error ? e.message : String(e)}`,
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
      if (
        e &&
        typeof e === 'object' &&
        'timedOut' in e &&
        (e as { timedOut?: boolean }).timedOut
      ) {
        return {
          error: `Tool execution timed out after ${resolvedTimeout / 1000} seconds.`,
          status: 'failed' as const,
        };
      }
      return {
        error: e instanceof Error ? e.message : String(e),
        status: 'failed' as const,
      };
    }
  }

  private async executeWithTimeout<T>(
    ms: number,
    fn: () => Promise<T>,
  ): Promise<T | { error: string; status: 'failed' }> {
    let timerId: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timerId = setTimeout(
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
      return {
        error: e instanceof Error ? e.message : String(e),
        status: 'failed',
      };
    } finally {
      if (timerId) {
        clearTimeout(timerId);
      }
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

  /**
   * Merge stdout and stderr into a single string, then optionally truncate
   * to `maxChars` keeping the **tail** (most recent output).
   *
   * Tail-preserving is intentional: when a command times out or crashes,
   * the most actionable signal is what the process was doing last, not
   * what it printed at startup.
   *
   * When `maxChars` is omitted the raw merged string is returned unchanged
   * (normal exit paths rely on the tool script's own limiting).
   */
  private mergeOutput(
    stdout: string,
    stderr: string,
    maxChars?: number,
  ): string {
    const merged = stderr.trim()
      ? `${stdout}\n${stderr}`.trim()
      : stdout.trim();
    if (maxChars === undefined || merged.length <= maxChars) return merged;
    return (
      `...[output truncated — showing last ${maxChars} of ${merged.length} chars]\n` +
      merged.slice(-maxChars)
    );
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
    options: ExecutionOptions = {},
  ): [string[], string[]] {
    const sandbox = cfg.security?.sandbox;
    if (!sandbox?.enabled) {
      return [[runtime, logic], []];
    }

    if (sandbox.provider === 'docker') {
      const image = sandbox.image || 'aura-sandbox:latest';
      const extraMounts: string[] = [];
      let containerLogic = logic;
      const realLogic = fs.existsSync(logic) ? fs.realpathSync(logic) : logic;
      const realProject = fs.existsSync(this.projectPath)
        ? fs.realpathSync(this.projectPath)
        : this.projectPath;
      const realEnv = fs.existsSync(this.envPath)
        ? fs.realpathSync(this.envPath)
        : this.envPath;

      if (realLogic.startsWith(realProject)) {
        const relLogic = path
          .relative(realProject, realLogic)
          .replace(/\\/g, '/');
        containerLogic = `/app/${relLogic}`;
      } else if (realLogic.startsWith(realEnv)) {
        const relLogic = path.relative(realEnv, realLogic).replace(/\\/g, '/');
        containerLogic = `/env/${relLogic}`;
        extraMounts.push('-v', `${realEnv}:/env`);
      }

      // Resolve database path translation
      const sessionName =
        options.sessionName || process.env.AURA_SESSION_NAME || 'default';
      const hostDbPath =
        options.sessionDbPath ||
        process.env.AURA_STATE_DB_PATH ||
        PathResolver.sessionDbPath(this.projectPath, sessionName);

      let containerDbPath = hostDbPath;
      if (hostDbPath) {
        const realDbPath = fs.existsSync(hostDbPath)
          ? fs.realpathSync(hostDbPath)
          : path.resolve(hostDbPath);

        if (realDbPath.startsWith(realProject)) {
          const relDb = path
            .relative(realProject, realDbPath)
            .replace(/\\/g, '/');
          containerDbPath = `/app/${relDb}`;
        } else if (realDbPath.startsWith(realEnv)) {
          const relDb = path.relative(realEnv, realDbPath).replace(/\\/g, '/');
          containerDbPath = `/env/${relDb}`;
          const envMountStr = `${realEnv}:/env`;
          if (!extraMounts.includes(envMountStr)) {
            extraMounts.push('-v', envMountStr);
          }
        } else {
          // Mount database directory dynamically
          const dbDir = path.dirname(realDbPath);
          const dbFile = path.basename(realDbPath);
          const mountName = 'db_mount';
          extraMounts.push('-v', `${dbDir}:/${mountName}`);
          containerDbPath = `/${mountName}/${dbFile}`;
        }
      }

      return [
        [
          'docker',
          'run',
          '--rm',
          '-i',
          '-e',
          `AURA_STATE_DB_PATH=${containerDbPath}`,
          '-e',
          `AURA_SESSION_NAME=${sessionName}`,
          '-v',
          `${realProject}:/app`,
          ...extraMounts,
          '-w',
          '/app',
          image,
          runtime,
          containerLogic,
        ],
        [],
      ];
    }

    if (sandbox.provider === 'local') {
      const wrapper = path.join(this.envPath, 'bin', 'sandbox-wrapper');
      if (fs.existsSync(wrapper)) {
        return [[wrapper, runtime, logic], []];
      }
      throw new Error(
        `Local sandbox provider wrapper not found at ${wrapper}. Please ensure the wrapper is installed or disable sandbox mode.`,
      );
    }

    if (sandbox.provider && sandbox.provider !== 'docker') {
      throw new Error(`Unsupported sandbox provider: ${sandbox.provider}`);
    }

    return [[runtime, logic], []];
  }
}

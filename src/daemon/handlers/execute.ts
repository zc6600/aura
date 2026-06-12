import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { readLastLinesSync } from '../../utils/fsUtils.js';
import * as PathResolver from '../../utils/pathResolver.js';
import type { HandlerFunction } from '../router.js';

interface ProcessMetadata {
  pid: number;
  command: string;
  cwd: string;
  started_at: number;
  timeout_seconds?: number;
  stdout_file?: string;
  stderr_file?: string;
  status: string;
  exit_code?: number | null;
  ended_at?: number;
}

export const listProcesses: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  const envPath =
    PathResolver.environmentPath(server.projectPath) || server.projectPath;
  const commandsDir = path.join(envPath, 'state', 'commands');

  if (!fs.existsSync(commandsDir) || !fs.statSync(commandsDir).isDirectory()) {
    server.sendResult(ctx.socket, ctx.id, { processes: [] });
    return;
  }

  let files: string[];
  try {
    files = fs.readdirSync(commandsDir);
  } catch (_err: any) {
    server.sendResult(ctx.socket, ctx.id, { processes: [] });
    return;
  }

  const items: any[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(commandsDir, file);
    try {
      const rawContent = fs.readFileSync(filePath, 'utf-8');
      const meta = JSON.parse(rawContent) as ProcessMetadata;
      if (!meta || typeof meta !== 'object' || typeof meta.pid !== 'number') {
        continue;
      }

      const pid = meta.pid;
      let isAlive = false;
      try {
        process.kill(pid, 0);
        isAlive = true;
      } catch (err: any) {
        isAlive = err.code === 'EPERM';
      }

      if (!isAlive && meta.status === 'running') {
        meta.status = 'finished';
        meta.ended_at = Date.now() / 1000;
        try {
          fs.writeFileSync(filePath, JSON.stringify(meta, null, 2), 'utf-8');
        } catch {}
      }

      const outPath = meta.stdout_file || path.join(commandsDir, `${pid}.out`);
      const errPath = meta.stderr_file || path.join(commandsDir, `${pid}.err`);
      const outBytes = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
      const errBytes = fs.existsSync(errPath) ? fs.statSync(errPath).size : 0;

      const elapsed = meta.started_at
        ? Math.max(0, (meta.ended_at || Date.now() / 1000) - meta.started_at)
        : null;

      items.push({
        pid,
        status: isAlive ? 'running' : meta.status,
        command: meta.command,
        stdout_bytes: outBytes,
        stderr_bytes: errBytes,
        elapsed_seconds: elapsed,
        started_at: meta.started_at,
        ended_at: meta.ended_at || null,
        timeout_seconds: meta.timeout_seconds || null,
      });
    } catch {}
  }

  server.sendResult(ctx.socket, ctx.id, { processes: items });
};

export const getProcessLogs: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  const p = ctx.params as Record<string, unknown> | null | undefined;
  const pidParam = p?.pid;

  if (pidParam === undefined || pidParam === null) {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32602,
      'Missing required parameter "pid".',
    );
    return;
  }

  const pid = Number(pidParam);
  if (Number.isNaN(pid)) {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32602,
      'Invalid parameter "pid" (must be a number).',
    );
    return;
  }

  const limit = typeof p?.limit === 'number' ? p.limit : 100;

  const envPath =
    PathResolver.environmentPath(server.projectPath) || server.projectPath;
  const commandsDir = path.join(envPath, 'state', 'commands');

  const metadataPath = path.join(commandsDir, `${pid}.json`);
  if (!fs.existsSync(metadataPath)) {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32602,
      `Process with PID ${pid} is not tracked by Aura.`,
    );
    return;
  }

  try {
    const rawContent = fs.readFileSync(metadataPath, 'utf-8');
    const meta = JSON.parse(rawContent) as ProcessMetadata;

    const outPath = meta.stdout_file || path.join(commandsDir, `${pid}.out`);
    const errPath = meta.stderr_file || path.join(commandsDir, `${pid}.err`);

    const readLastLines = (filePath: string, maxLines: number): string => {
      return readLastLinesSync(filePath, maxLines);
    };

    const stdout = readLastLines(outPath, limit);
    const stderr = readLastLines(errPath, limit);

    let isAlive = false;
    try {
      process.kill(pid, 0);
      isAlive = true;
    } catch (err: any) {
      isAlive = err.code === 'EPERM';
    }

    if (!isAlive && meta.status === 'running') {
      meta.status = 'finished';
      meta.ended_at = Date.now() / 1000;
      try {
        fs.writeFileSync(metadataPath, JSON.stringify(meta, null, 2), 'utf-8');
      } catch {}
    }

    server.sendResult(ctx.socket, ctx.id, {
      pid,
      status: isAlive ? 'running' : meta.status,
      command: meta.command,
      stdout,
      stderr,
    });
  } catch (err: any) {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32603,
      `Failed to retrieve process logs: ${err.message}`,
    );
  }
};

export const killProcess: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  const p = ctx.params as Record<string, unknown> | null | undefined;
  const pidParam = p?.pid;

  if (pidParam === undefined || pidParam === null) {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32602,
      'Missing required parameter "pid".',
    );
    return;
  }

  const pid = Number(pidParam);
  if (Number.isNaN(pid)) {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32602,
      'Invalid parameter "pid" (must be a number).',
    );
    return;
  }

  const sigName = String(p?.signal || 'SIGTERM').toUpperCase();
  const validSignals = ['SIGTERM', 'SIGKILL', 'SIGINT'];
  if (!validSignals.includes(sigName)) {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32602,
      `Invalid signal "${sigName}". Must be one of: ${validSignals.join(', ')}`,
    );
    return;
  }

  const envPath =
    PathResolver.environmentPath(server.projectPath) || server.projectPath;
  const commandsDir = path.join(envPath, 'state', 'commands');
  const metadataPath = path.join(commandsDir, `${pid}.json`);

  try {
    process.kill(pid, sigName as any);

    if (fs.existsSync(metadataPath)) {
      try {
        const rawContent = fs.readFileSync(metadataPath, 'utf-8');
        const meta = JSON.parse(rawContent) as ProcessMetadata;
        meta.status = 'killed';
        meta.ended_at = Date.now() / 1000;
        fs.writeFileSync(metadataPath, JSON.stringify(meta, null, 2), 'utf-8');
      } catch {}
    }

    server.sendResult(ctx.socket, ctx.id, {
      success: true,
      pid,
      signal: sigName,
    });
  } catch (err: any) {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32603,
      `Failed to kill process ${pid}: ${err.message}`,
    );
  }
};

export const subscribeLogs: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  const p = ctx.params as Record<string, unknown> | null | undefined;
  const pidParam = p?.pid;

  if (pidParam === undefined || pidParam === null) {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32602,
      'Missing required parameter "pid".',
    );
    return;
  }

  const pid = Number(pidParam);
  if (Number.isNaN(pid)) {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32602,
      'Invalid parameter "pid" (must be a number).',
    );
    return;
  }

  const envPath =
    PathResolver.environmentPath(server.projectPath) || server.projectPath;
  const commandsDir = path.join(envPath, 'state', 'commands');

  const metadataPath = path.join(commandsDir, `${pid}.json`);
  if (!fs.existsSync(metadataPath)) {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32602,
      `Process with PID ${pid} is not tracked by Aura.`,
    );
    return;
  }

  server.sendResult(ctx.socket, ctx.id, { subscribed: true, pid });

  const rawContent = fs.readFileSync(metadataPath, 'utf-8');
  const meta = JSON.parse(rawContent) as ProcessMetadata;
  const outPath = meta.stdout_file || path.join(commandsDir, `${pid}.out`);
  const errPath = meta.stderr_file || path.join(commandsDir, `${pid}.err`);

  let outOffset = 0;
  let errOffset = 0;

  function readAndSendInChunks(
    filePath: string,
    startOffset: number,
    endOffset: number,
    stream: 'stdout' | 'stderr',
  ): void {
    if (startOffset >= endOffset) return;
    let fd: number | null = null;
    const decoder = new StringDecoder('utf8');
    try {
      fd = fs.openSync(filePath, 'r');
      const CHUNK_SIZE = 65536;
      const buffer = Buffer.alloc(CHUNK_SIZE);
      let offset = startOffset;
      let leftover = '';

      while (offset < endOffset && !ctx.socket.destroyed) {
        const toRead = Math.min(CHUNK_SIZE, endOffset - offset);
        const bytesRead = fs.readSync(fd, buffer, 0, toRead, offset);
        if (bytesRead <= 0) break;

        const chunkStr = decoder.write(buffer.subarray(0, bytesRead));
        const combined = leftover + chunkStr;
        const lines = combined.split('\n');

        if (offset + bytesRead < endOffset) {
          leftover = lines.pop() ?? '';
        } else {
          leftover = '';
        }

        for (const line of lines) {
          if (line.trim()) {
            ctx.socket.write(
              `${JSON.stringify({
                jsonrpc: '2.0',
                method: 'execute/onLog',
                params: { pid, stream, line },
              })}\n`,
            );
          }
        }

        offset += bytesRead;
      }

      const endStr = decoder.end();
      const finalStr = leftover + endStr;
      if (finalStr.trim() && !ctx.socket.destroyed) {
        ctx.socket.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            method: 'execute/onLog',
            params: { pid, stream, line: finalStr },
          })}\n`,
        );
      }
    } catch (_err) {
      // ignore
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {}
      }
    }
  }

  function tailFile(
    filePath: string,
    currentOffset: number,
    stream: 'stdout' | 'stderr',
  ): number {
    if (!fs.existsSync(filePath)) return currentOffset;
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > currentOffset) {
        readAndSendInChunks(filePath, currentOffset, stats.size, stream);
        return stats.size;
      }
    } catch {}
    return currentOffset;
  }

  let outWatcher: fs.FSWatcher | null = null;
  let errWatcher: fs.FSWatcher | null = null;
  let metaWatcher: fs.FSWatcher | null = null;
  let pollInterval: NodeJS.Timeout | null = null;

  const cleanup = () => {
    if (outWatcher) {
      outWatcher.close();
      outWatcher = null;
    }
    if (errWatcher) {
      errWatcher.close();
      errWatcher = null;
    }
    if (metaWatcher) {
      metaWatcher.close();
      metaWatcher = null;
    }
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    ctx.socket.removeListener('close', cleanup);
    ctx.socket.removeListener('end', cleanup);
    ctx.socket.removeListener('error', cleanup);
  };

  const checkStatusAndCleanup = () => {
    try {
      if (fs.existsSync(metadataPath)) {
        const raw = fs.readFileSync(metadataPath, 'utf-8');
        const currentMeta = JSON.parse(raw) as ProcessMetadata;

        // Perform active liveness check as well to be safe
        let isAlive = false;
        try {
          process.kill(pid, 0);
          isAlive = true;
        } catch (err: any) {
          isAlive = err.code === 'EPERM';
        }

        if (!isAlive && currentMeta.status === 'running') {
          currentMeta.status = 'finished';
          currentMeta.ended_at = Date.now() / 1000;
          try {
            fs.writeFileSync(
              metadataPath,
              JSON.stringify(currentMeta, null, 2),
              'utf-8',
            );
          } catch {}
        }

        if (currentMeta.status !== 'running') {
          // Process has exited. Send any remaining logs
          outOffset = tailFile(outPath, outOffset, 'stdout');
          errOffset = tailFile(errPath, errOffset, 'stderr');

          if (!ctx.socket.destroyed) {
            ctx.socket.write(
              `${JSON.stringify({
                jsonrpc: '2.0',
                method: 'execute/onProcessEnded',
                params: {
                  pid,
                  status: currentMeta.status,
                  exit_code: currentMeta.exit_code ?? null,
                  ended_at: currentMeta.ended_at || null,
                },
              })}\n`,
            );
          }
          cleanup();
        }
      }
    } catch {}
  };

  // Initial read of logs up to current offset
  if (fs.existsSync(outPath)) {
    const size = fs.statSync(outPath).size;
    readAndSendInChunks(outPath, 0, size, 'stdout');
    outOffset = size;
  }
  if (fs.existsSync(errPath)) {
    const size = fs.statSync(errPath).size;
    readAndSendInChunks(errPath, 0, size, 'stderr');
    errOffset = size;
  }

  // Initial status check
  checkStatusAndCleanup();

  // If still running, set up watchers and/or polling fallback
  try {
    const raw = fs.readFileSync(metadataPath, 'utf-8');
    const currentMeta = JSON.parse(raw) as ProcessMetadata;
    if (currentMeta.status === 'running') {
      let watchFailed = false;

      if (fs.existsSync(outPath)) {
        try {
          outWatcher = fs.watch(outPath, (event) => {
            if (event === 'change') {
              outOffset = tailFile(outPath, outOffset, 'stdout');
            }
          });
          outWatcher.on('error', () => {});
        } catch {
          watchFailed = true;
        }
      } else {
        watchFailed = true;
      }

      if (fs.existsSync(errPath)) {
        try {
          errWatcher = fs.watch(errPath, (event) => {
            if (event === 'change') {
              errOffset = tailFile(errPath, errOffset, 'stderr');
            }
          });
          errWatcher.on('error', () => {});
        } catch {
          watchFailed = true;
        }
      } else {
        watchFailed = true;
      }

      try {
        metaWatcher = fs.watch(metadataPath, (event) => {
          if (event === 'change') {
            checkStatusAndCleanup();
          }
        });
        metaWatcher.on('error', () => {});
      } catch {
        watchFailed = true;
      }

      if (watchFailed) {
        pollInterval = setInterval(() => {
          if (!outWatcher) {
            outOffset = tailFile(outPath, outOffset, 'stdout');
          }
          if (!errWatcher) {
            errOffset = tailFile(errPath, errOffset, 'stderr');
          }
          checkStatusAndCleanup();
        }, 1000);
      }
    }
  } catch {}

  ctx.socket.on('close', cleanup);
  ctx.socket.on('end', cleanup);
  ctx.socket.on('error', cleanup);
};

export const sendInput: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  const p = ctx.params as Record<string, unknown> | null | undefined;
  const pidParam = p?.pid;
  const input = p?.input;

  if (pidParam === undefined || pidParam === null) {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32602,
      'Missing required parameter "pid".',
    );
    return;
  }
  if (typeof input !== 'string') {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32602,
      'Missing required parameter "input" (must be a string).',
    );
    return;
  }

  const pid = Number(pidParam);
  if (Number.isNaN(pid)) {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32602,
      'Invalid parameter "pid" (must be a number).',
    );
    return;
  }

  if (!server.runner) {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32603,
      'No active runner. Start a session first.',
    );
    return;
  }

  // Delegate to ExecutionEngine's send_process_input dispatch
  try {
    const result = await server.runner
      .getEngine()
      .execute('send_process_input', { pid, input });
    server.sendResult(ctx.socket, ctx.id, result);
  } catch (err: any) {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32603,
      `Failed to send input: ${err.message}`,
    );
  }
};

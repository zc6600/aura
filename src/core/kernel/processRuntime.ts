import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { readLastLinesSync } from '../../utils/fsUtils.js';
import * as PathResolver from '../../utils/pathResolver.js';
import { errorCode } from '../../utils/typing.js';
import type { ExecutionEngine } from './executionEngine.js';
import type { ToolResult } from './interfaces.js';

export interface ProcessMetadata {
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

export interface ProcessLogSubscription {
  cleanup(): void;
}

export class ProcessRuntime {
  private readonly envPath: string;
  private readonly commandsDir: string;

  constructor(
    projectPath: string,
    private readonly engine?: ExecutionEngine,
  ) {
    this.envPath =
      PathResolver.environmentPath(projectPath) || path.resolve(projectPath);
    this.commandsDir = path.join(this.envPath, 'state', 'commands');
  }

  public listProcesses(): { processes: Array<Record<string, unknown>> } {
    if (
      !fs.existsSync(this.commandsDir) ||
      !fs.statSync(this.commandsDir).isDirectory()
    ) {
      return { processes: [] };
    }

    let files: string[];
    try {
      files = fs.readdirSync(this.commandsDir);
    } catch (_err) {
      return { processes: [] };
    }

    const processes: Array<Record<string, unknown>> = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(this.commandsDir, file);
      try {
        const meta = JSON.parse(
          fs.readFileSync(filePath, 'utf-8'),
        ) as ProcessMetadata;
        if (!meta || typeof meta !== 'object' || typeof meta.pid !== 'number') {
          continue;
        }

        const isAlive = this.isProcessAlive(meta.pid);
        if (!isAlive && meta.status === 'running') {
          meta.status = 'finished';
          meta.ended_at = Date.now() / 1000;
          try {
            fs.writeFileSync(filePath, JSON.stringify(meta, null, 2), 'utf-8');
          } catch {}
        }

        const outPath =
          meta.stdout_file || path.join(this.commandsDir, `${meta.pid}.out`);
        const errPath =
          meta.stderr_file || path.join(this.commandsDir, `${meta.pid}.err`);
        const elapsed = meta.started_at
          ? Math.max(0, (meta.ended_at || Date.now() / 1000) - meta.started_at)
          : null;

        processes.push({
          pid: meta.pid,
          status: isAlive ? 'running' : meta.status,
          command: meta.command,
          stdout_bytes: fs.existsSync(outPath) ? fs.statSync(outPath).size : 0,
          stderr_bytes: fs.existsSync(errPath) ? fs.statSync(errPath).size : 0,
          elapsed_seconds: elapsed,
          started_at: meta.started_at,
          ended_at: meta.ended_at || null,
          timeout_seconds: meta.timeout_seconds || null,
        });
      } catch {}
    }

    return { processes };
  }

  public getProcessLogs(
    pid: number,
    limit = 100,
  ): {
    pid: number;
    status: string;
    command: string;
    stdout: string;
    stderr: string;
  } {
    const { meta, metadataPath } = this.readMetadata(pid);
    const outPath =
      meta.stdout_file || path.join(this.commandsDir, `${pid}.out`);
    const errPath =
      meta.stderr_file || path.join(this.commandsDir, `${pid}.err`);

    const stdout = readLastLinesSync(outPath, limit);
    const stderr = readLastLinesSync(errPath, limit);

    const isAlive = this.isProcessAlive(pid);
    if (!isAlive && meta.status === 'running') {
      meta.status = 'finished';
      meta.ended_at = Date.now() / 1000;
      try {
        fs.writeFileSync(metadataPath, JSON.stringify(meta, null, 2), 'utf-8');
      } catch {}
    }

    return {
      pid,
      status: isAlive ? 'running' : meta.status,
      command: meta.command,
      stdout,
      stderr,
    };
  }

  public killProcess(
    pid: number,
    signal: 'SIGTERM' | 'SIGKILL' | 'SIGINT' = 'SIGTERM',
  ): { success: true; pid: number; signal: string } {
    const { meta, metadataPath } = this.readMetadata(pid);
    process.kill(pid, signal);
    meta.status = 'killed';
    meta.ended_at = Date.now() / 1000;
    try {
      fs.writeFileSync(metadataPath, JSON.stringify(meta, null, 2), 'utf-8');
    } catch {}
    return { success: true, pid, signal };
  }

  public async sendInput(pid: number, input: string): Promise<ToolResult> {
    if (!this.engine) {
      throw new Error('No active runner. Start a session first.');
    }
    return await this.engine.execute('send_process_input', { pid, input });
  }

  public subscribeLogs(
    pid: number,
    callbacks: {
      isClosed?: () => boolean;
      onLog: (payload: {
        pid: number;
        stream: 'stdout' | 'stderr';
        line: string;
      }) => void;
      onProcessEnded: (payload: {
        pid: number;
        status: string;
        exit_code: number | null;
        ended_at: number | null;
      }) => void;
      onCleanup?: (cleanup: () => void) => void;
    },
  ): ProcessLogSubscription {
    const { meta, metadataPath } = this.readMetadata(pid);
    const outPath =
      meta.stdout_file || path.join(this.commandsDir, `${pid}.out`);
    const errPath =
      meta.stderr_file || path.join(this.commandsDir, `${pid}.err`);

    let outOffset = 0;
    let errOffset = 0;
    let outWatcher: fs.FSWatcher | null = null;
    let errWatcher: fs.FSWatcher | null = null;
    let metaWatcher: fs.FSWatcher | null = null;
    let pollInterval: NodeJS.Timeout | null = null;

    const closed = () => callbacks.isClosed?.() === true;

    const readAndSendInChunks = (
      filePath: string,
      startOffset: number,
      endOffset: number,
      stream: 'stdout' | 'stderr',
    ): void => {
      if (startOffset >= endOffset) return;
      let fd: number | null = null;
      const decoder = new StringDecoder('utf8');
      try {
        fd = fs.openSync(filePath, 'r');
        const chunkSize = 65536;
        const buffer = Buffer.alloc(chunkSize);
        let offset = startOffset;
        let leftover = '';

        while (offset < endOffset && !closed()) {
          const toRead = Math.min(chunkSize, endOffset - offset);
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
            if (line.trim()) callbacks.onLog({ pid, stream, line });
          }
          offset += bytesRead;
        }

        const finalStr = leftover + decoder.end();
        if (finalStr.trim() && !closed()) {
          callbacks.onLog({ pid, stream, line: finalStr });
        }
      } catch (_err) {
      } finally {
        if (fd !== null) {
          try {
            fs.closeSync(fd);
          } catch {}
        }
      }
    };

    const tailFile = (
      filePath: string,
      currentOffset: number,
      stream: 'stdout' | 'stderr',
    ): number => {
      if (!fs.existsSync(filePath)) return currentOffset;
      try {
        const stats = fs.statSync(filePath);
        let offset = currentOffset;
        if (stats.size < offset) offset = 0;
        if (stats.size > offset) {
          readAndSendInChunks(filePath, offset, stats.size, stream);
          return stats.size;
        }
        return offset;
      } catch {}
      return currentOffset;
    };

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
    };

    const checkStatusAndCleanup = () => {
      try {
        if (!fs.existsSync(metadataPath)) return;
        const currentMeta = JSON.parse(
          fs.readFileSync(metadataPath, 'utf-8'),
        ) as ProcessMetadata;

        const isAlive = this.isProcessAlive(pid);
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
          outOffset = tailFile(outPath, outOffset, 'stdout');
          errOffset = tailFile(errPath, errOffset, 'stderr');
          if (!closed()) {
            callbacks.onProcessEnded({
              pid,
              status: currentMeta.status,
              exit_code: currentMeta.exit_code ?? null,
              ended_at: currentMeta.ended_at || null,
            });
          }
          cleanup();
        }
      } catch {}
    };

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

    checkStatusAndCleanup();
    if (closed()) {
      cleanup();
      return { cleanup };
    }

    try {
      const currentMeta = JSON.parse(
        fs.readFileSync(metadataPath, 'utf-8'),
      ) as ProcessMetadata;
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
            if (event === 'change') checkStatusAndCleanup();
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

    callbacks.onCleanup?.(cleanup);
    return { cleanup };
  }

  private readMetadata(pid: number): {
    meta: ProcessMetadata;
    metadataPath: string;
  } {
    const metadataPath = path.join(this.commandsDir, `${pid}.json`);
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`Process with PID ${pid} is not tracked by Aura.`);
    }
    const meta = JSON.parse(
      fs.readFileSync(metadataPath, 'utf-8'),
    ) as ProcessMetadata;
    return { meta, metadataPath };
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: unknown) {
      return errorCode(err) === 'EPERM';
    }
  }
}

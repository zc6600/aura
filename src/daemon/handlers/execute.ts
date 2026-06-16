import { ProcessRuntime } from '../../core/kernel/processRuntime.js';
import type { HandlerFunction } from '../router.js';

const validSignals = ['SIGTERM', 'SIGKILL', 'SIGINT'] as const;
type ValidSignal = (typeof validSignals)[number];

function processRuntime(ctx: Parameters<HandlerFunction>[0]): ProcessRuntime {
  const runner = ctx.server.runner as
    | {
        getProcessRuntime?: () => ProcessRuntime;
        getEngine?: () => ConstructorParameters<typeof ProcessRuntime>[1];
      }
    | null
    | undefined;
  if (typeof runner?.getProcessRuntime === 'function') {
    return runner.getProcessRuntime();
  }
  if (typeof runner?.getEngine === 'function') {
    return new ProcessRuntime(ctx.server.projectPath, runner.getEngine());
  }
  return new ProcessRuntime(ctx.server.projectPath);
}

function parsePid(ctx: Parameters<HandlerFunction>[0]): number | null {
  const pidParam = (ctx.params as Record<string, unknown> | null | undefined)
    ?.pid;
  if (pidParam === undefined || pidParam === null) {
    ctx.server.sendError(
      ctx.socket,
      ctx.id,
      -32602,
      'Missing required parameter "pid".',
    );
    return null;
  }
  const pid = Number(pidParam);
  if (Number.isNaN(pid)) {
    ctx.server.sendError(
      ctx.socket,
      ctx.id,
      -32602,
      'Invalid parameter "pid" (must be a number).',
    );
    return null;
  }
  return pid;
}

export const listProcesses: HandlerFunction = async (ctx) => {
  try {
    ctx.server.sendResult(
      ctx.socket,
      ctx.id,
      processRuntime(ctx).listProcesses(),
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.server.sendError(ctx.socket, ctx.id, -32603, msg);
  }
};

export const getProcessLogs: HandlerFunction = async (ctx) => {
  const pid = parsePid(ctx);
  if (pid === null) return;
  const p = ctx.params as Record<string, unknown> | null | undefined;
  const limit = typeof p?.limit === 'number' ? p.limit : 100;

  try {
    ctx.server.sendResult(
      ctx.socket,
      ctx.id,
      processRuntime(ctx).getProcessLogs(pid, limit),
    );
  } catch (err: any) {
    ctx.server.sendError(
      ctx.socket,
      ctx.id,
      err.message?.includes('not tracked') ? -32602 : -32603,
      `Failed to retrieve process logs: ${err.message}`,
    );
  }
};

export const killProcess: HandlerFunction = async (ctx) => {
  const pid = parsePid(ctx);
  if (pid === null) return;
  const p = ctx.params as Record<string, unknown> | null | undefined;
  const signal = String(p?.signal || 'SIGTERM').toUpperCase();
  if (!validSignals.includes(signal as ValidSignal)) {
    ctx.server.sendError(
      ctx.socket,
      ctx.id,
      -32602,
      `Invalid signal "${signal}". Must be one of: ${validSignals.join(', ')}`,
    );
    return;
  }

  try {
    ctx.server.sendResult(
      ctx.socket,
      ctx.id,
      processRuntime(ctx).killProcess(pid, signal as ValidSignal),
    );
  } catch (err: any) {
    ctx.server.sendError(
      ctx.socket,
      ctx.id,
      err.message?.includes('not tracked') ? -32602 : -32603,
      `Failed to kill process ${pid}: ${err.message}`,
    );
  }
};

export const subscribeLogs: HandlerFunction = async (ctx) => {
  if (ctx.socket.destroyed) return;
  const pid = parsePid(ctx);
  if (pid === null) return;

  try {
    ctx.server.sendResult(ctx.socket, ctx.id, { subscribed: true, pid });
    let cleanup: (() => void) | null = null;
    cleanup = processRuntime(ctx).subscribeLogs(pid, {
      isClosed: () => ctx.socket.destroyed,
      onLog: (payload) => {
        if (!ctx.socket.destroyed) {
          ctx.socket.write(
            `${JSON.stringify({
              jsonrpc: '2.0',
              method: 'execute/onLog',
              params: payload,
            })}\n`,
          );
        }
      },
      onProcessEnded: (payload) => {
        if (!ctx.socket.destroyed) {
          ctx.socket.write(
            `${JSON.stringify({
              jsonrpc: '2.0',
              method: 'execute/onProcessEnded',
              params: payload,
            })}\n`,
          );
        }
      },
      onCleanup: (fn) => {
        cleanup = fn;
      },
    }).cleanup;

    const removeListeners = () => {
      cleanup?.();
      ctx.socket.removeListener('close', removeListeners);
      ctx.socket.removeListener('end', removeListeners);
      ctx.socket.removeListener('error', removeListeners);
    };
    ctx.socket.on('close', removeListeners);
    ctx.socket.on('end', removeListeners);
    ctx.socket.on('error', removeListeners);
  } catch (err: any) {
    ctx.server.sendError(
      ctx.socket,
      ctx.id,
      err.message?.includes('not tracked') ? -32602 : -32603,
      err.message,
    );
  }
};

export const sendInput: HandlerFunction = async (ctx) => {
  const pid = parsePid(ctx);
  if (pid === null) return;
  const input = (ctx.params as Record<string, unknown> | null | undefined)
    ?.input;
  if (typeof input !== 'string') {
    ctx.server.sendError(
      ctx.socket,
      ctx.id,
      -32602,
      'Missing required parameter "input" (must be a string).',
    );
    return;
  }

  try {
    const result = await processRuntime(ctx).sendInput(pid, input);
    ctx.server.sendResult(ctx.socket, ctx.id, result);
  } catch (err: any) {
    ctx.server.sendError(
      ctx.socket,
      ctx.id,
      -32603,
      `Failed to send input: ${err.message}`,
    );
  }
};

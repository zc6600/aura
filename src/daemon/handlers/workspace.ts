import { Runner } from '../../core/kernel/runner.js';
import { WorkspaceRuntime } from '../../core/kernel/workspaceRuntime.js';
import type { HandlerFunction } from '../router.js';

export const initialize: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  if (server.activeLoopJob.status === 'running') {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32603,
      'Cannot initialize workspace while a goal loop is running.',
    );
    return;
  }
  const p = ctx.params as Record<string, unknown> | null | undefined;
  const { sessionName } = p || {};
  if (server.runner) {
    try {
      server.runner.destroy();
    } catch {}
  }
  const runner = new Runner(server.projectPath);
  server.runner = runner;
  if (sessionName) {
    runner.reconnectSession(sessionName as string);
  }
  server.sendResult(ctx.socket, ctx.id, {
    initialized: true,
    projectPath: server.projectPath,
    sessionName: runner.sessionName,
  });
};

export const writeFile: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  const p = ctx.params as Record<string, unknown> | null | undefined;
  const filePath = p?.path;
  const content = p?.content;
  if (typeof filePath !== 'string' || typeof content !== 'string') {
    server.sendError(ctx.socket, ctx.id, -32602, 'Invalid path or content.');
    return;
  }
  try {
    const runtime =
      server.runner?.getWorkspaceRuntime() ??
      new WorkspaceRuntime(server.projectPath);
    server.sendResult(ctx.socket, ctx.id, runtime.writeFile(filePath, content));
  } catch (err: unknown) {
    const msg = (err as Error).message ?? String(err);
    server.sendError(ctx.socket, ctx.id, -32603, `Write error: ${msg}`);
  }
};

export const readFile: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  const p = ctx.params as Record<string, unknown> | null | undefined;
  const filePath = p?.path;
  if (typeof filePath !== 'string') {
    server.sendError(ctx.socket, ctx.id, -32602, 'Invalid path.');
    return;
  }
  try {
    const runtime =
      server.runner?.getWorkspaceRuntime() ??
      new WorkspaceRuntime(server.projectPath);
    server.sendResult(ctx.socket, ctx.id, runtime.readFile(filePath));
  } catch (err: unknown) {
    const msg = (err as Error).message ?? String(err);
    server.sendError(ctx.socket, ctx.id, -32603, `Read error: ${msg}`);
  }
};

export const getFileTree: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  try {
    const runtime =
      server.runner?.getWorkspaceRuntime() ??
      new WorkspaceRuntime(server.projectPath);
    server.sendResult(ctx.socket, ctx.id, runtime.getFileTree());
  } catch (err: unknown) {
    const msg = (err as Error).message ?? String(err);
    server.sendError(
      ctx.socket,
      ctx.id,
      -32603,
      `Failed to get file tree: ${msg}`,
    );
  }
};

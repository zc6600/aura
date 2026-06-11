import type { HandlerFunction } from '../router.js';

export const listSessions: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  const list = server.sessionManager.list();
  server.sendResult(ctx.socket, ctx.id, { sessions: list });
};

export const createSession: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  const p = ctx.params as Record<string, unknown> | null | undefined;
  const name = p?.name;
  if (!name || typeof name !== 'string') {
    server.sendError(ctx.socket, ctx.id, -32602, 'Invalid session name.');
    return;
  }
  const session = server.sessionManager.create(name, p);
  server.sendResult(ctx.socket, ctx.id, { session });
};

export const activateSession: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  if (server.activeLoopJob.status === 'running') {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32603,
      'Cannot activate session while a goal loop is running.',
    );
    return;
  }
  const p = ctx.params as Record<string, unknown> | null | undefined;
  const name = p?.name;
  if (!name || typeof name !== 'string') {
    server.sendError(ctx.socket, ctx.id, -32602, 'Invalid session name.');
    return;
  }
  server.sessionManager.activate(name);
  if (server.runner) {
    server.runner.reconnectSession(name);
  }
  server.sendResult(ctx.socket, ctx.id, { activeSession: name });
};

export const deleteSession: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  if (server.activeLoopJob.status === 'running') {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32603,
      'Cannot delete session while a goal loop is running.',
    );
    return;
  }
  const p = ctx.params as Record<string, unknown> | null | undefined;
  const name = p?.name;
  if (!name || typeof name !== 'string') {
    server.sendError(ctx.socket, ctx.id, -32602, 'Invalid session name.');
    return;
  }
  const activeSession = server.runner
    ? server.runner.sessionName
    : server.sessionManager.currentName() || 'default';
  if (name === activeSession) {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32602,
      `Cannot delete the active session: ${name}`,
    );
    return;
  }
  const success = server.sessionManager.delete(name);
  server.sendResult(ctx.socket, ctx.id, { success });
};

export const renameSession: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  if (server.activeLoopJob.status === 'running') {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32603,
      'Cannot rename session while a goal loop is running.',
    );
    return;
  }
  const p = ctx.params as Record<string, unknown> | null | undefined;
  const oldName = p?.oldName;
  const newName = p?.newName;
  if (
    !oldName ||
    typeof oldName !== 'string' ||
    !newName ||
    typeof newName !== 'string'
  ) {
    server.sendError(ctx.socket, ctx.id, -32602, 'Invalid session names.');
    return;
  }
  const session = server.sessionManager.rename(oldName, newName);
  if (server.runner && server.runner.sessionName === oldName) {
    server.runner.reconnectSession(newName);
  }
  server.sendResult(ctx.socket, ctx.id, { session });
};

export const duplicateSession: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  if (server.activeLoopJob.status === 'running') {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32603,
      'Cannot duplicate session while a goal loop is running.',
    );
    return;
  }
  const p = ctx.params as Record<string, unknown> | null | undefined;
  const sourceName = p?.sourceName;
  const newName = p?.newName;
  if (
    !sourceName ||
    typeof sourceName !== 'string' ||
    !newName ||
    typeof newName !== 'string'
  ) {
    server.sendError(ctx.socket, ctx.id, -32602, 'Invalid session names.');
    return;
  }
  const session = server.sessionManager.duplicate(sourceName, newName);
  server.sendResult(ctx.socket, ctx.id, { session });
};

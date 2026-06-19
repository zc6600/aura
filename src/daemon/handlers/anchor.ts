import type { HandlerFunction } from '../router.js';
import {
  listAnchors,
  loadCompletedAnchorMap,
  revokeAnchorEvents,
  sessionDbPath,
  submitAnchorEvent,
} from './anchorShared.js';

export const getAnchors: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  try {
    const activeSession = server.runner ? server.runner.sessionName : 'default';
    const dbPath = sessionDbPath(server.projectPath, activeSession);
    const completedMap = loadCompletedAnchorMap(dbPath);
    const anchors = listAnchors(server.projectPath, completedMap);
    server.sendResult(ctx.socket, ctx.id, { anchors });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? String(err);
    server.sendError(ctx.socket, ctx.id, -32603, `Get anchors error: ${msg}`);
  }
};

export const submitAnchor: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  const p = ctx.params as Record<string, unknown> | null | undefined;
  const anchorId = p?.anchor_id;
  if (!anchorId || typeof anchorId !== 'string') {
    server.sendError(
      ctx.socket,
      ctx.id,
      -32602,
      'Invalid anchor_id parameter.',
    );
    return;
  }

  try {
    const activeSession = server.runner ? server.runner.sessionName : 'default';
    const dbPath = sessionDbPath(server.projectPath, activeSession);
    if (p.revoke) {
      revokeAnchorEvents({ dbPath, anchorId });
    } else {
      submitAnchorEvent({
        dbPath,
        anchorId,
        summary: p.summary,
        notes: p.notes,
        selectedNext: p.selected_next,
        anchorRuntimeUpdate: p.anchor_runtime_update,
      });
    }
    server.sendResult(ctx.socket, ctx.id, { success: true });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? String(err);
    server.sendError(ctx.socket, ctx.id, -32603, `Submit anchor error: ${msg}`);
  }
};

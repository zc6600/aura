import type { Socket } from 'node:net';
import * as agentHandlers from './handlers/agent.js';
import * as daemonHandlers from './handlers/daemon.js';
import * as executeHandlers from './handlers/execute.js';
import * as gardenHandlers from './handlers/garden.js';
import * as sessionHandlers from './handlers/session.js';
import * as workspaceHandlers from './handlers/workspace.js';

import type { DaemonServer } from './server.js';

export interface RequestContext {
  server: DaemonServer;
  socket: Socket;
  id: unknown;
  params: any;
}

export type HandlerFunction = (ctx: RequestContext) => Promise<void> | void;

const registry: Record<string, HandlerFunction> = {
  'workspace/initialize': workspaceHandlers.initialize,
  'workspace/readFile': workspaceHandlers.readFile,
  'workspace/writeFile': workspaceHandlers.writeFile,
  'workspace/getFileTree': workspaceHandlers.getFileTree,

  'session/list': sessionHandlers.listSessions,
  'session/create': sessionHandlers.createSession,
  'session/activate': sessionHandlers.activateSession,
  'session/delete': sessionHandlers.deleteSession,
  'session/rename': sessionHandlers.renameSession,
  'session/duplicate': sessionHandlers.duplicateSession,

  'agent/runGoal': agentHandlers.runGoal,

  'garden/getStatus': gardenHandlers.getStatus,
  'garden/getAnchors': gardenHandlers.getAnchors,
  'garden/submitAnchor': gardenHandlers.submitAnchor,

  'daemon/status': daemonHandlers.status,
  'daemon/exit': daemonHandlers.exit,

  'execute/listProcesses': executeHandlers.listProcesses,
  'execute/getProcessLogs': executeHandlers.getProcessLogs,
  'execute/killProcess': executeHandlers.killProcess,
  'execute/subscribeLogs': executeHandlers.subscribeLogs,
  'execute/sendInput': executeHandlers.sendInput,
};

export async function dispatchRequest(
  method: string,
  ctx: RequestContext,
): Promise<void> {
  const handler = registry[method];
  if (!handler) {
    ctx.server.sendError(
      ctx.socket,
      ctx.id,
      -32601,
      `Method not found: ${method}`,
    );
    return;
  }
  try {
    await handler(ctx);
  } catch (err: unknown) {
    const msg = (err as Error).message ?? String(err);
    ctx.server.sendError(ctx.socket, ctx.id, -32603, `Internal error: ${msg}`);
  }
}

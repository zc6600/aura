import type { HandlerFunction } from '../router.js';

export const status: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  server.sendResult(ctx.socket, ctx.id, {
    projectPath: server.projectPath,
    activeSession: server.runner ? server.runner.sessionName : 'default',
    jobStatus: server.activeLoopJob.status,
    connectionsCount: server.connections.size,
  });
};

export const exit: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  server.sendResult(ctx.socket, ctx.id, { exiting: true });
  setImmediate(() => server.stop());
};

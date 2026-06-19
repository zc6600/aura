import fs from 'node:fs';
import { HintProvider } from '../../core/context/providers/hintProvider.js';
import type { HandlerFunction } from '../router.js';
import { getAnchorsProgress, sessionDbPath } from './anchorShared.js';

export const getStatus: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  try {
    const sessionMgr = server.sessionManager;
    const sessionsList = sessionMgr.list({ includeMissing: false });
    let soilSize = 0;
    for (const session of sessionsList) {
      try {
        if (fs.existsSync(session.db_path)) {
          soilSize += fs.statSync(session.db_path).size;
        }
        for (const suffix of ['-journal', '-wal', '-shm']) {
          const sidecar = `${session.db_path}${suffix}`;
          if (fs.existsSync(sidecar)) {
            soilSize += fs.statSync(sidecar).size;
          }
        }
      } catch {}
    }
    const sessionsCount = sessionsList.length;

    const activeSession = server.runner ? server.runner.sessionName : 'default';
    const dbPath = sessionDbPath(server.projectPath, activeSession);
    const anchorsProgress = getAnchorsProgress(server.projectPath, dbPath);

    let activeHintsCount = 0;
    try {
      const hintsProvider = new HintProvider(server.projectPath);
      const provided = hintsProvider.provide();
      if (provided) {
        activeHintsCount = provided
          .split('\n')
          .filter((line) => line.trim().length > 0).length;
      }
    } catch {}

    server.sendResult(ctx.socket, ctx.id, {
      soilSize,
      sessionsCount,
      anchorsProgress,
      activeHintsCount,
    });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? String(err);
    server.sendError(ctx.socket, ctx.id, -32603, `Garden status error: ${msg}`);
  }
};

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { HintProvider } from '../../core/context/providers/hintProvider.js';
import { SQLiteStore } from '../../core/memory/sqliteStore.js';
import * as PathResolver from '../../utils/pathResolver.js';
import type { HandlerFunction } from '../router.js';

interface AnchorInfo {
  id: string;
  name?: string;
  description?: string;
  call_when?: string[];
  status: 'completed' | 'pending';
  completedAt?: string;
  summary?: string;
}

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
    const dbPath = PathResolver.sessionDbPath(
      server.projectPath,
      activeSession,
    );
    let completedIds: string[] = [];
    if (fs.existsSync(dbPath)) {
      const store = new SQLiteStore({ dbPath });
      try {
        const events = store.fetchAnchorSubmitEvents();
        completedIds = events
          .map((e) => e.payload.anchor_id)
          .filter(Boolean) as string[];
      } catch (e: unknown) {
        console.warn(`Error querying database: ${(e as Error).message}`);
      } finally {
        store.close();
      }
    }

    const anchorsDir = path.join(server.projectPath, 'anchors');
    let totalAnchors = 0;
    let completedAnchors = 0;
    const pendingAnchors: string[] = [];

    if (fs.existsSync(anchorsDir) && fs.statSync(anchorsDir).isDirectory()) {
      fs.readdirSync(anchorsDir).forEach((file) => {
        const full = path.join(anchorsDir, file);
        if (!fs.statSync(full).isFile()) return;
        const ext = path.extname(file).toLowerCase();
        if (!['.json', '.yaml', '.yml'].includes(ext)) return;

        totalAnchors++;
        try {
          const content = fs.readFileSync(full, 'utf-8');
          const data =
            ext === '.json' ? JSON.parse(content) : yaml.parse(content);
          const id = data.id || path.basename(file, ext);
          if (completedIds.includes(id)) {
            completedAnchors++;
          } else {
            pendingAnchors.push(id);
          }
        } catch {
          pendingAnchors.push(path.basename(file, ext));
        }
      });
    }

    const ratio =
      totalAnchors > 0 ? (completedAnchors / totalAnchors) * 100 : 0;
    const anchorsProgress = {
      completed: completedAnchors,
      total: totalAnchors,
      ratio: Number(ratio.toFixed(1)),
      pending: pendingAnchors,
    };

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

export const getAnchors: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  try {
    const activeSession = server.runner ? server.runner.sessionName : 'default';
    const dbPath = PathResolver.sessionDbPath(
      server.projectPath,
      activeSession,
    );
    const completedMap = new Map<
      string,
      { summary: string; timestamp: number }
    >();
    if (fs.existsSync(dbPath)) {
      const store = new SQLiteStore({ dbPath });
      try {
        const events = store.fetchAnchorSubmitEvents();
        for (const event of events) {
          if (event.payload.anchor_id) {
            completedMap.set(event.payload.anchor_id as string, {
              summary: (event.payload.summary as string) || '',
              timestamp: event.timestamp,
            });
          }
        }
      } catch (e: unknown) {
        console.warn(`Error querying database: ${(e as Error).message}`);
      } finally {
        store.close();
      }
    }

    const anchorsDir = path.join(server.projectPath, 'anchors');
    const anchors: AnchorInfo[] = [];

    if (fs.existsSync(anchorsDir) && fs.statSync(anchorsDir).isDirectory()) {
      const files = fs.readdirSync(anchorsDir);
      for (const file of files) {
        const full = path.join(anchorsDir, file);
        if (!fs.statSync(full).isFile()) continue;
        const ext = path.extname(file).toLowerCase();
        if (!['.json', '.yaml', '.yml'].includes(ext)) continue;

        try {
          const content = fs.readFileSync(full, 'utf-8');
          const data =
            ext === '.json' ? JSON.parse(content) : yaml.parse(content);
          const id = data.id || path.basename(file, ext);
          const completedInfo = completedMap.get(id);

          anchors.push({
            id,
            name: data.name || id,
            description: data.description || '',
            call_when: Array.isArray(data.call_when)
              ? data.call_when
              : data.call_when
                ? [data.call_when]
                : [],
            status: completedInfo ? 'completed' : 'pending',
            completedAt: completedInfo
              ? new Date(completedInfo.timestamp * 1000).toISOString()
              : undefined,
            summary: completedInfo ? completedInfo.summary : undefined,
          });
        } catch {
          const id = path.basename(file, ext);
          const completedInfo = completedMap.get(id);
          anchors.push({
            id,
            status: completedInfo ? 'completed' : 'pending',
            completedAt: completedInfo
              ? new Date(completedInfo.timestamp * 1000).toISOString()
              : undefined,
            summary: completedInfo ? completedInfo.summary : undefined,
          });
        }
      }
    }

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
    const dbPath = PathResolver.sessionDbPath(
      server.projectPath,
      activeSession,
    );
    const store = new SQLiteStore({ dbPath });
    try {
      if (p.revoke) {
        const rows = store
          .getRawDb()
          .prepare(
            "SELECT id, payload FROM events WHERE tool = 'anchor_submit'",
          )
          .all() as { id: number; payload: string }[];
        const toDelete: number[] = [];
        for (const row of rows) {
          try {
            const payload = JSON.parse(row.payload);
            if (payload.anchor_id === anchorId) {
              toDelete.push(row.id);
            }
          } catch {}
        }
        if (toDelete.length > 0) {
          store.deleteEvents(toDelete);
        }
      } else {
        store.insertEvent({
          timestamp: Math.floor(Date.now() / 1000),
          phase: 'tool',
          tool: 'anchor_submit',
          payload: {
            anchor_id: anchorId,
            summary: p.summary || '',
          },
        });
      }
      server.sendResult(ctx.socket, ctx.id, { success: true });
    } finally {
      store.close();
    }
  } catch (err: unknown) {
    const msg = (err as Error).message ?? String(err);
    server.sendError(ctx.socket, ctx.id, -32603, `Submit anchor error: ${msg}`);
  }
};

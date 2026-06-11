import fs from 'node:fs';
import path from 'node:path';
import { Runner } from '../../core/kernel/runner.js';
import * as PathResolver from '../../utils/pathResolver.js';
import type { HandlerFunction } from '../router.js';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
}

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
    const safePath = PathResolver.validateSafePath(
      filePath,
      server.projectPath,
    );
    const relative = path.relative(server.projectPath, safePath);
    const parts = relative.split(/[\\/]/);
    if (
      parts.includes('.git') ||
      parts.includes('.aura') ||
      parts.includes('node_modules')
    ) {
      server.sendError(
        ctx.socket,
        ctx.id,
        -32602,
        `Access denied to restricted path: ${filePath}`,
      );
      return;
    }
    fs.mkdirSync(path.dirname(safePath), { recursive: true });
    fs.writeFileSync(safePath, content, 'utf-8');
    server.sendResult(ctx.socket, ctx.id, { success: true });
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
    const safePath = PathResolver.validateSafePath(
      filePath,
      server.projectPath,
    );
    const relative = path.relative(server.projectPath, safePath);
    const parts = relative.split(/[\\/]/);
    if (
      parts.includes('.git') ||
      parts.includes('.aura') ||
      parts.includes('node_modules')
    ) {
      server.sendError(
        ctx.socket,
        ctx.id,
        -32602,
        `Access denied to restricted path: ${filePath}`,
      );
      return;
    }
    if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) {
      server.sendError(
        ctx.socket,
        ctx.id,
        -32602,
        `File not found: ${filePath}`,
      );
      return;
    }
    const content = fs.readFileSync(safePath, 'utf-8');
    server.sendResult(ctx.socket, ctx.id, { content });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? String(err);
    server.sendError(ctx.socket, ctx.id, -32603, `Read error: ${msg}`);
  }
};

export const getFileTree: HandlerFunction = async (ctx) => {
  const server = ctx.server;
  try {
    let totalItemsCount = 0;
    const buildTree = (
      currentDir: string,
      currentDepth: number,
    ): FileNode[] => {
      const nodes: FileNode[] = [];
      if (currentDepth > 4 || totalItemsCount >= 1000) return nodes;

      let children: string[] = [];
      try {
        children = fs.readdirSync(currentDir).sort();
      } catch (_e) {
        return nodes;
      }

      for (const name of children) {
        if (totalItemsCount >= 1000) break;
        if (name.startsWith('.')) continue;

        const fullPath = path.join(currentDir, name);
        const relPath = path
          .relative(server.projectPath, fullPath)
          .replace(/\\/g, '/');

        const isIgnored = Runner.IGNORED_SCAN_DIRS.some(
          (d) =>
            relPath === d ||
            relPath.startsWith(`${d}/`) ||
            relPath.includes(`/${d}/`),
        );
        if (isIgnored) continue;

        try {
          const stat = fs.statSync(fullPath);
          totalItemsCount++;
          if (stat.isDirectory()) {
            nodes.push({
              name,
              path: relPath,
              type: 'dir',
              children: buildTree(fullPath, currentDepth + 1),
            });
          } else if (stat.isFile()) {
            nodes.push({
              name,
              path: relPath,
              type: 'file',
            });
          }
        } catch (_e) {}
      }
      return nodes;
    };

    const tree = buildTree(server.projectPath, 1);
    server.sendResult(ctx.socket, ctx.id, { tree });
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

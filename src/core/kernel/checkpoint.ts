import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as PathResolver from '../../utils/pathResolver.js';
import type { ToolResult } from './interfaces.js';

/** A single completed tool call recorded by the agent loop. */
export interface LoopStep {
  tool: string;
  args: Record<string, unknown>;
  summary?: string | null;
  result: ToolResult;
}

export type CheckpointReason = 'user_paused' | 'sandbox_path_blocked';

/**
 * A serialized snapshot of an agent loop, taken at an iteration boundary.
 *
 * Everything here is plain JSON. The loop is only ever suspended between
 * steps, so there is no in-flight tool or LLM state to capture — the live
 * objects (engine, LSP, MCP, session DB handle) are rebuilt on resume, and
 * the durable conversational memory lives in the session SQLite DB.
 */
export interface LoopCheckpoint {
  version: 1;
  goal: string;
  ctx: string;
  stepCount: number;
  steps: LoopStep[];
  formatErrors: number;
  toolErrors: number;
  reason: CheckpointReason;
  /** Set when reason is 'sandbox_path_blocked': the path a human must approve. */
  blockedPath?: string;
  sessionName: string;
  createdAt: string;
}

/**
 * Resolves the checkpoint slot for a session. One slot per session — resuming
 * means "continue what this session was doing", so a second run in the same
 * session deliberately replaces the previous snapshot.
 */
export function checkpointPath(root: string, sessionName: string): string {
  const envPath = PathResolver.environmentPath(root) || root;
  const dir = path.join(envPath, 'state', 'kernel_checkpoints');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${sessionName}.json`);
}

/**
 * Writes a checkpoint atomically.
 *
 * The temp file carries a pid + random suffix rather than a fixed `.tmp`:
 * several daemons can share one project directory, and a fixed suffix lets
 * two writers clobber each other's temp file and rename a torn one into place.
 */
export function saveCheckpoint(
  filePath: string,
  checkpoint: LoopCheckpoint,
): void {
  const tempPath = `${filePath}.${process.pid}.${crypto
    .randomBytes(4)
    .toString('hex')}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (_e) {
    try {
      fs.unlinkSync(tempPath);
    } catch {}
  }
}

export function loadCheckpoint(filePath: string): LoopCheckpoint | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const parsed = JSON.parse(
      fs.readFileSync(filePath, 'utf-8'),
    ) as Partial<LoopCheckpoint>;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.goal !== 'string'
    ) {
      return null;
    }
    // Tolerate checkpoints written before a field existed rather than
    // discarding an otherwise-resumable run.
    return {
      version: 1,
      goal: parsed.goal,
      ctx: typeof parsed.ctx === 'string' ? parsed.ctx : '',
      stepCount: typeof parsed.stepCount === 'number' ? parsed.stepCount : 0,
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      formatErrors:
        typeof parsed.formatErrors === 'number' ? parsed.formatErrors : 0,
      toolErrors: typeof parsed.toolErrors === 'number' ? parsed.toolErrors : 0,
      reason:
        parsed.reason === 'sandbox_path_blocked'
          ? 'sandbox_path_blocked'
          : 'user_paused',
      blockedPath: parsed.blockedPath,
      sessionName:
        typeof parsed.sessionName === 'string' ? parsed.sessionName : 'default',
      createdAt:
        typeof parsed.createdAt === 'string'
          ? parsed.createdAt
          : new Date(0).toISOString(),
    };
  } catch (_e) {
    return null;
  }
}

export function clearCheckpoint(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (_e) {}
}

/**
 * Builds the banner prepended to a resumed context. The model is told it was
 * interrupted on purpose: the working tree may have changed while it was
 * parked, so re-checking beats silently assuming the snapshot still holds.
 */
export function resumeBanner(checkpoint: LoopCheckpoint): string {
  const lines =
    checkpoint.reason === 'sandbox_path_blocked'
      ? [
          `[RESUMED] This run was paused because a command needed a path outside the sandbox: ${checkpoint.blockedPath || 'unknown'}`,
          'That path should now be approved (or you were told to try a different approach). Continue the task below.',
        ]
      : [
          `[RESUMED] This run was paused by the user after step ${checkpoint.stepCount} and is now continuing.`,
          'Files may have changed while you were paused — verify the current state before repeating or assuming earlier work.',
        ];
  return `${lines.join('\n')}\n\n${checkpoint.ctx}`;
}

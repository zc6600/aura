import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearCheckpoint,
  type LoopCheckpoint,
  loadCheckpoint,
  resumeBanner,
  saveCheckpoint,
} from '../../src/core/kernel/checkpoint.js';

function makeCheckpoint(
  overrides: Partial<LoopCheckpoint> = {},
): LoopCheckpoint {
  return {
    version: 1,
    goal: 'do the thing',
    ctx: 'the saved context',
    stepCount: 3,
    steps: [
      {
        tool: 'bash',
        args: { command: 'ls' },
        summary: 'list',
        result: { status: 'ok' },
      },
    ],
    formatErrors: 1,
    toolErrors: 2,
    reason: 'user_paused',
    sessionName: 'default',
    createdAt: '2026-07-29T00:00:00.000Z',
    ...overrides,
  };
}

describe('checkpoint', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-checkpoint-'));
    file = path.join(dir, 'default.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a checkpoint without losing loop state', () => {
    const cp = makeCheckpoint();
    saveCheckpoint(file, cp);

    expect(loadCheckpoint(file)).toEqual(cp);
  });

  it('leaves no temp files behind after a write', () => {
    saveCheckpoint(file, makeCheckpoint());

    expect(fs.readdirSync(dir)).toEqual(['default.json']);
  });

  it('creates missing parent directories', () => {
    const nested = path.join(dir, 'a', 'b', 'default.json');
    saveCheckpoint(nested, makeCheckpoint());

    expect(loadCheckpoint(nested)?.goal).toBe('do the thing');
  });

  it('returns null for a missing checkpoint', () => {
    expect(loadCheckpoint(file)).toBeNull();
  });

  it('returns null rather than throwing on a corrupt checkpoint', () => {
    fs.writeFileSync(file, '{ not json');

    expect(loadCheckpoint(file)).toBeNull();
  });

  it('rejects a checkpoint with no goal, since it cannot be resumed', () => {
    fs.writeFileSync(file, JSON.stringify({ ctx: 'orphaned', stepCount: 4 }));

    expect(loadCheckpoint(file)).toBeNull();
  });

  it('backfills fields missing from an older checkpoint', () => {
    // A checkpoint written before steps/error budgets were captured should
    // still resume rather than being discarded wholesale.
    fs.writeFileSync(
      file,
      JSON.stringify({ goal: 'legacy run', ctx: 'old ctx', stepCount: 2 }),
    );

    expect(loadCheckpoint(file)).toEqual({
      version: 1,
      goal: 'legacy run',
      ctx: 'old ctx',
      stepCount: 2,
      steps: [],
      formatErrors: 0,
      toolErrors: 0,
      reason: 'user_paused',
      blockedPath: undefined,
      sessionName: 'default',
      createdAt: new Date(0).toISOString(),
    });
  });

  it('clears a checkpoint and tolerates clearing a missing one', () => {
    saveCheckpoint(file, makeCheckpoint());
    clearCheckpoint(file);
    expect(fs.existsSync(file)).toBe(false);

    expect(() => clearCheckpoint(file)).not.toThrow();
  });

  it('tells a resumed run it was paused and the tree may have moved', () => {
    const banner = resumeBanner(makeCheckpoint({ stepCount: 7 }));

    expect(banner).toContain('[RESUMED]');
    expect(banner).toContain('step 7');
    expect(banner).toContain('may have changed');
    expect(banner).toContain('the saved context');
  });

  it('explains the blocked path when resuming a sandbox escalation', () => {
    const banner = resumeBanner(
      makeCheckpoint({
        reason: 'sandbox_path_blocked',
        blockedPath: '/etc/passwd',
      }),
    );

    expect(banner).toContain('/etc/passwd');
    expect(banner).toContain('outside the sandbox');
  });
});

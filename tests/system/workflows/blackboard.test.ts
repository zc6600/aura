import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSystemWorkspace,
  parseJsonOutput,
  requireSystemLlmConfig,
  runAura,
  runSystemTests,
  type SystemWorkspace,
} from '../utils/systemHarness.js';

const describeSystem = runSystemTests ? describe : describe.skip;

interface KernelLoopOutput {
  steps: Array<{
    tool: string;
    status: string | null;
  }>;
  final: Record<string, unknown>;
}

describeSystem('System blackboard workflow', { timeout: 180000 }, () => {
  let workspace: SystemWorkspace;

  beforeEach(async () => {
    workspace = await createSystemWorkspace(
      'blackboard',
      requireSystemLlmConfig(),
    );
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it('writes and reads a shared blackboard payload through a real loop', async () => {
    const key = `system_board_${Date.now()}`;
    const token = `AURA_BLACKBOARD_${Date.now()}`;

    const result = await runAura(workspace, [
      'kernel',
      'loop',
      '-g',
      [
        'Use the blackboard tool for this task.',
        `Write key ${key} with JSON content {"token":"${token}","source":"system-test"}.`,
        `Then read key ${key} back from the blackboard.`,
        'After the read succeeds, finish with a concise final answer containing the token.',
      ].join(' '),
      '--max-steps',
      '4',
    ]);

    expect(result.exitCode).toBe(0);

    const payload = parseJsonOutput<KernelLoopOutput>(result.stdout);
    expect(payload.steps.some((step) => step.tool === 'blackboard')).toBe(true);

    const blackboardPath = path.join(
      workspace.auraDir,
      'state',
      'sessions',
      'default',
      'bus',
      `${key}.json`,
    );
    expect(fs.existsSync(blackboardPath)).toBe(true);

    const stored = JSON.parse(fs.readFileSync(blackboardPath, 'utf-8')) as {
      data?: {
        token?: string;
        source?: string;
      };
    };
    expect(stored.data?.token).toBe(token);
    expect(stored.data?.source).toBe('system-test');
  });
});

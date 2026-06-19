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
    args?: Record<string, unknown>;
    output?: string;
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

  function resolveBlackboardPath(
    payload: KernelLoopOutput,
    fallbackPath: string,
  ): string {
    const writeStep = payload.steps.find((step) => {
      if (step.tool !== 'blackboard') return false;
      if (step.args?.action !== 'write') return false;
      return (
        typeof step.output === 'string' && step.output.trim().startsWith('{')
      );
    });

    if (writeStep?.output) {
      try {
        const parsed = JSON.parse(writeStep.output) as { path?: string };
        if (parsed.path) return parsed.path;
      } catch {}
    }

    return fallbackPath;
  }

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

    if (result.exitCode !== 0) {
      throw new Error(
        [
          `aura kernel loop exited with code ${result.exitCode}`,
          '',
          'STDERR:',
          result.stderr || '(empty)',
          '',
          'STDOUT:',
          result.stdout || '(empty)',
        ].join('\n'),
      );
    }

    expect(result.exitCode).toBe(0);

    const payload = parseJsonOutput<KernelLoopOutput>(result.stdout);
    expect(payload.steps.some((step) => step.tool === 'blackboard')).toBe(true);

    const fallbackPath = path.join(
      workspace.auraDir,
      'state',
      'sessions',
      'default',
      'bus',
      `${key}.json`,
    );
    const blackboardPath = resolveBlackboardPath(payload, fallbackPath);
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

  it('overwrites an existing blackboard key and reads back only the latest payload', async () => {
    const key = `system_board_overwrite_${Date.now()}`;
    const firstToken = `AURA_BLACKBOARD_OLD_${Date.now()}`;
    const secondToken = `AURA_BLACKBOARD_NEW_${Date.now()}`;

    const result = await runAura(workspace, [
      'kernel',
      'loop',
      '-g',
      [
        'Use the tool named `blackboard` for this task.',
        `First call \`blackboard\` with action "write", key "${key}", and content {"token":"${firstToken}","version":"old"}.`,
        `Then call \`blackboard\` again with action "write", key "${key}", and content {"token":"${secondToken}","version":"new"}.`,
        `Then call \`blackboard\` with action "read" for key "${key}".`,
        'Do not use any other tool before those blackboard calls.',
        'After the read succeeds, finish with a concise final answer containing only the latest token.',
      ].join(' '),
      '--max-steps',
      '6',
    ]);

    expect(result.exitCode).toBe(0);

    const payload = parseJsonOutput<KernelLoopOutput>(result.stdout);
    const blackboardSteps = payload.steps.filter(
      (step) => step.tool === 'blackboard',
    );
    expect(blackboardSteps.length).toBeGreaterThanOrEqual(3);
    expect(
      blackboardSteps.filter((step) => step.args?.action === 'write').length,
    ).toBeGreaterThanOrEqual(2);
    expect(blackboardSteps.some((step) => step.args?.action === 'read')).toBe(
      true,
    );
    expect(JSON.stringify(blackboardSteps)).toContain(firstToken);

    const fallbackPath = path.join(
      workspace.auraDir,
      'state',
      'sessions',
      'default',
      'bus',
      `${key}.json`,
    );
    const blackboardPath = resolveBlackboardPath(payload, fallbackPath);
    expect(fs.existsSync(blackboardPath)).toBe(true);

    const stored = JSON.parse(fs.readFileSync(blackboardPath, 'utf-8')) as {
      data?: {
        token?: string;
        version?: string;
      };
    };
    expect(stored.data?.token).toBe(secondToken);
    expect(stored.data?.version).toBe('new');
  });
});

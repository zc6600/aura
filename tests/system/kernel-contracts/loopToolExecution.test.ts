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

describeSystem('System tool loop', { timeout: 180000 }, () => {
  let workspace: SystemWorkspace;

  beforeEach(async () => {
    workspace = await createSystemWorkspace(
      'tool-loop',
      requireSystemLlmConfig(),
    );
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it('uses real planning to perform a tiny file side effect', async () => {
    const targetPath = path.join(workspace.root, 'system-loop-output.txt');
    const result = await runAura(workspace, [
      'kernel',
      'loop',
      '-g',
      'Use the write_file tool to create system-loop-output.txt containing exactly: AURA_SYSTEM_LOOP_OK. Then finish.',
      '--max-steps',
      '4',
    ]);

    expect(result.exitCode).toBe(0);

    const payload = parseJsonOutput<KernelLoopOutput>(result.stdout);
    expect(payload.steps.length).toBeGreaterThan(0);
    expect(payload.steps.some((step) => step.tool === 'write_file')).toBe(true);
    expect(fs.existsSync(targetPath)).toBe(true);
    expect(fs.readFileSync(targetPath, 'utf-8')).toContain(
      'AURA_SYSTEM_LOOP_OK',
    );
  });
});

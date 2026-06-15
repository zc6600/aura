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
    output: string;
  }>;
  final: {
    status?: string;
    content?: string;
    reason?: string;
  };
}

describeSystem('System loop completion (no tools)', { timeout: 120000 }, () => {
  let workspace: SystemWorkspace;

  beforeEach(async () => {
    workspace = await createSystemWorkspace(
      'loop-no-tools',
      requireSystemLlmConfig(),
    );
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it('can complete with a pure final answer and no tool calls', async () => {
    const token = `AURA_NO_TOOL_${Date.now()}`;
    const result = await runAura(workspace, [
      'kernel',
      'loop',
      '-g',
      `Include this token in your final answer: ${token}. Do not call any tools unless strictly necessary.`,
      '--max-steps',
      '2',
    ]);

    expect(result.exitCode).toBe(0);

    const payload = parseJsonOutput<KernelLoopOutput>(result.stdout);
    expect(payload.final?.status).toBe('completed');
    expect(payload.final?.content).toContain(token);
  });
});

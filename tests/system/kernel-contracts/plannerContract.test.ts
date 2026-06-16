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

interface KernelPlanOutput {
  context_preview: string;
  plan: {
    type?: string;
    tool?: string;
    args?: Record<string, unknown>;
    content?: string;
    finish_reason?: string | null;
  };
}

describeSystem('System planner contract', { timeout: 120000 }, () => {
  let workspace: SystemWorkspace;

  beforeEach(async () => {
    workspace = await createSystemWorkspace(
      'planner-contract',
      requireSystemLlmConfig(),
    );
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it('returns a parser-compatible plan from a real LLM', async () => {
    const result = await runAura(workspace, [
      'kernel',
      'plan',
      '-g',
      'Inspect the workspace enough to decide the next safe action. If no tool is needed, provide a concise final answer.',
    ]);

    expect(result.exitCode).toBe(0);

    const payload = parseJsonOutput<KernelPlanOutput>(result.stdout);
    expect(payload.context_preview.length).toBeGreaterThan(0);
    expect(['text', 'tool_call']).toContain(payload.plan.type);

    if (payload.plan.type === 'tool_call') {
      expect(payload.plan.tool?.trim().length).toBeGreaterThan(0);
      expect(payload.plan.args && typeof payload.plan.args).toBe('object');
    } else {
      expect(typeof payload.plan.content).toBe('string');
    }
  });
});

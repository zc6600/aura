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

describeSystem('System plan proposal workflow', { timeout: 180000 }, () => {
  let workspace: SystemWorkspace;

  beforeEach(async () => {
    workspace = await createSystemWorkspace(
      'plan-proposal',
      requireSystemLlmConfig(),
    );
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it('creates a persisted implementation plan through a real tool loop', async () => {
    const runId = `system_plan_${Date.now()}`;
    const goal = `Prepare the tiny system test plan ${runId}`;

    const result = await runAura(workspace, [
      'kernel',
      'loop',
      '-g',
      [
        'Use the plan_proposal tool to create an implementation plan.',
        `Set run_id exactly to ${runId}.`,
        `Set goal exactly to: ${goal}.`,
        'Include two short steps and one verification command.',
        'After the tool succeeds, finish with a concise final answer.',
      ].join(' '),
      '--max-steps',
      '3',
    ]);

    expect(result.exitCode).toBe(0);

    const payload = parseJsonOutput<KernelLoopOutput>(result.stdout);
    expect(payload.steps.some((step) => step.tool === 'plan_proposal')).toBe(
      true,
    );

    const runDir = path.join(workspace.auraDir, 'state', 'runs', runId);
    const planJsonPath = path.join(runDir, 'plan.json');
    const planMdPath = path.join(runDir, 'plan.md');

    expect(fs.existsSync(planJsonPath)).toBe(true);
    expect(fs.existsSync(planMdPath)).toBe(true);

    const plan = JSON.parse(fs.readFileSync(planJsonPath, 'utf-8')) as {
      goal?: string;
      run_id?: string;
      status?: string;
      steps?: string[];
      verification_commands?: string[];
    };

    expect(plan.run_id).toBe(runId);
    expect(plan.goal).toBe(goal);
    expect(plan.status).toBe('pending');
    expect(plan.steps?.length).toBeGreaterThanOrEqual(2);
    expect(plan.verification_commands?.length).toBeGreaterThanOrEqual(1);
    expect(fs.readFileSync(planMdPath, 'utf-8')).toContain(goal);
  });
});

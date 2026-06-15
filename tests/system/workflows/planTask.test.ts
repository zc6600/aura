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

describeSystem('System task checklist workflow', { timeout: 180000 }, () => {
  let workspace: SystemWorkspace;

  beforeEach(async () => {
    workspace = await createSystemWorkspace(
      'plan-task',
      requireSystemLlmConfig(),
    );
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it('persists a checklist with progress through a real tool loop', async () => {
    const runId = `system_tasks_${Date.now()}`;
    const taskOne = `collect token ${runId}`;
    const taskTwo = `verify token ${runId}`;

    const result = await runAura(workspace, [
      'kernel',
      'loop',
      '-g',
      [
        'Use the plan_task tool to create a checklist.',
        `Set run_id exactly to ${runId}.`,
        `Use these exact tasks: "${taskOne}" and "${taskTwo}".`,
        'Mark only the first task completed using completed_indices [0].',
        'After the tool succeeds, finish with a concise final answer.',
      ].join(' '),
      '--max-steps',
      '3',
    ]);

    expect(result.exitCode).toBe(0);

    const payload = parseJsonOutput<KernelLoopOutput>(result.stdout);
    expect(payload.steps.some((step) => step.tool === 'plan_task')).toBe(true);

    const runDir = path.join(workspace.auraDir, 'state', 'runs', runId);
    const taskJsonPath = path.join(runDir, 'task.json');
    const taskMdPath = path.join(runDir, 'task.md');
    const rootTaskPath = path.join(workspace.root, 'task.md');

    expect(fs.existsSync(taskJsonPath)).toBe(true);
    expect(fs.existsSync(taskMdPath)).toBe(true);
    expect(fs.existsSync(rootTaskPath)).toBe(true);

    const taskData = JSON.parse(fs.readFileSync(taskJsonPath, 'utf-8')) as {
      tasks?: string[];
      completed?: number[];
      in_progress?: number[];
    };

    expect(taskData.tasks).toEqual([taskOne, taskTwo]);
    expect(taskData.completed).toEqual([0]);
    expect(taskData.in_progress ?? []).toEqual([]);

    const taskMarkdown = fs.readFileSync(taskMdPath, 'utf-8');
    expect(taskMarkdown).toContain(`- [x] ${taskOne}`);
    expect(taskMarkdown).toContain(`- [ ] ${taskTwo}`);
  });
});

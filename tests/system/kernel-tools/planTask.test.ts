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
  final: {
    task_path?: string;
    content?: string;
    [key: string]: unknown;
  };
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

  function resolveTaskArtifacts(
    runId: string,
    payload: KernelLoopOutput,
  ): { taskJsonPath: string; taskMdPath: string } {
    if (payload.final.task_path) {
      const taskMdPath = path.join(workspace.root, payload.final.task_path);
      return {
        taskJsonPath: path.join(path.dirname(taskMdPath), 'task.json'),
        taskMdPath,
      };
    }

    const candidateRunDirs = [
      path.join(workspace.auraDir, 'state', 'sessions', 'runs', runId),
      path.join(workspace.auraDir, 'state', 'runs', runId),
    ];

    for (const runDir of candidateRunDirs) {
      const taskJsonPath = path.join(runDir, 'task.json');
      const taskMdPath = path.join(runDir, 'task.md');
      if (fs.existsSync(taskJsonPath) && fs.existsSync(taskMdPath)) {
        return { taskJsonPath, taskMdPath };
      }
    }

    return {
      taskJsonPath: path.join(candidateRunDirs[0], 'task.json'),
      taskMdPath: path.join(candidateRunDirs[0], 'task.md'),
    };
  }

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

    const { taskJsonPath, taskMdPath } = resolveTaskArtifacts(runId, payload);
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

  it('updates an existing checklist run without losing prior progress', async () => {
    const runId = `system_tasks_update_${Date.now()}`;
    const taskOne = `collect token ${runId}`;
    const taskTwo = `verify token ${runId}`;

    const createResult = await runAura(workspace, [
      'kernel',
      'loop',
      '-g',
      [
        'Use the plan_task tool to create a checklist.',
        `Set run_id exactly to ${runId}.`,
        `Use these exact tasks: "${taskOne}" and "${taskTwo}".`,
        'Use action create and mark only the first task completed using completed_indices [0].',
        'After the tool succeeds, finish with a concise final answer.',
      ].join(' '),
      '--max-steps',
      '3',
    ]);
    expect(createResult.exitCode).toBe(0);
    const createPayload = parseJsonOutput<KernelLoopOutput>(
      createResult.stdout,
    );
    expect(createPayload.steps.some((step) => step.tool === 'plan_task')).toBe(
      true,
    );
    expect(createPayload.final.task_path).toBeTruthy();
    const runTaskPath = path.join(
      workspace.root,
      createPayload.final.task_path!,
    );
    expect(fs.existsSync(runTaskPath)).toBe(true);
    expect(fs.readFileSync(runTaskPath, 'utf-8')).toContain(`- [x] ${taskOne}`);
    expect(fs.readFileSync(runTaskPath, 'utf-8')).toContain(`- [ ] ${taskTwo}`);

    const updateResult = await runAura(workspace, [
      'kernel',
      'loop',
      '-g',
      [
        'Use the plan_task tool to update an existing checklist.',
        `Set run_id exactly to ${runId}.`,
        'Reuse the existing checklist for that run_id and do not recreate the task list.',
        'Use action update.',
        'Mark both tasks completed using completed_indices [0,1] and leave no tasks in progress.',
        'After the tool succeeds, finish with a concise final answer.',
      ].join(' '),
      '--max-steps',
      '3',
    ]);

    expect(updateResult.exitCode).toBe(0);

    const payload = parseJsonOutput<KernelLoopOutput>(updateResult.stdout);
    expect(payload.steps.some((step) => step.tool === 'plan_task')).toBe(true);
    expect(payload.final.task_path).toBe(createPayload.final.task_path);

    const rootTaskPath = path.join(workspace.root, 'task.md');
    expect(fs.existsSync(rootTaskPath)).toBe(true);
    expect(fs.existsSync(runTaskPath)).toBe(true);
    const runTaskMarkdown = fs.readFileSync(runTaskPath, 'utf-8');
    expect(runTaskMarkdown).toContain(`- [x] ${taskOne}`);
    expect(runTaskMarkdown).toContain(`- [x] ${taskTwo}`);
    const rootTaskMarkdown = fs.readFileSync(rootTaskPath, 'utf-8');
    expect(rootTaskMarkdown).toContain(`- [x] ${taskOne}`);
    expect(rootTaskMarkdown).toContain(`- [x] ${taskTwo}`);
    expect(JSON.stringify(payload.final)).toContain(taskOne);
    expect(JSON.stringify(payload.final)).toContain(taskTwo);
  });
});

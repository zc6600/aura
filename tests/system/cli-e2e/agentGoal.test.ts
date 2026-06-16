import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSystemWorkspace,
  requireSystemLlmConfig,
  runAura,
  runSystemTests,
  type SystemWorkspace,
} from '../utils/systemHarness.js';

const describeSystem = runSystemTests ? describe : describe.skip;

function expectExitCode(
  result: { exitCode: number | null; stdout: string; stderr: string },
  exitCode: number,
): void {
  expect(
    result.exitCode,
    JSON.stringify(
      {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      },
      null,
      2,
    ),
  ).toBe(exitCode);
}

function seedEditWorkflow(
  workspace: SystemWorkspace,
  sourceToken: string,
): {
  sourcePath: string;
  copiedPath: string;
  untouchedPath: string;
  untouchedContent: string;
} {
  const sourcePath = path.join(workspace.root, 'source.txt');
  const copiedPath = path.join(workspace.root, 'copied.txt');
  const untouchedPath = path.join(workspace.root, 'untouched.txt');
  const untouchedContent = `leave ${sourceToken} untouched here\n`;

  fs.writeFileSync(sourcePath, `${sourceToken}\n`, 'utf-8');
  fs.writeFileSync(untouchedPath, untouchedContent, 'utf-8');

  return { sourcePath, copiedPath, untouchedPath, untouchedContent };
}

function buildEditWorkflowGoal(
  sourceFile: string,
  outputFile: string,
): string {
  return [
    'Use tools for this task.',
    `First use read_file to inspect ${sourceFile}.`,
    `Then use write_file to create ${outputFile} with exactly the same contents you read from ${sourceFile}.`,
    'Do not edit untouched.txt.',
    'After the file update succeeds, finish with a concise final answer.',
  ].join(' ');
}

describeSystem('System agent goal CLI', { timeout: 240000 }, () => {
  let workspace: SystemWorkspace;

  beforeEach(async () => {
    workspace = await createSystemWorkspace(
      'agent-goal',
      requireSystemLlmConfig(),
    );
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it('completes a goal through the default daemon-backed agent entrypoint', async () => {
    const token = `AURA_AGENT_DAEMON_${Date.now()}`;

    const result = await runAura(workspace, [
      'agent',
      '-g',
      `Reply with only this exact token and do not call tools: ${token}`,
    ]);

    expectExitCode(result, 0);
    expect(result.stdout).toContain(token);
  });

  it('completes a goal through the local no-daemon agent entrypoint', async () => {
    const token = `AURA_AGENT_LOCAL_${Date.now()}`;

    const result = await runAura(workspace, [
      'agent',
      '-g',
      `Reply with only this exact token and do not call tools: ${token}`,
      '--no-daemon',
    ]);

    expectExitCode(result, 0);
    expect(result.stdout).toContain(token);
  });

  it('passes max-steps through the agent entrypoint to bound classic loop execution', async () => {
    const sourceToken = `AURA_MAX_STEPS_${Date.now()}`;
    const { copiedPath } = seedEditWorkflow(workspace, sourceToken);

    const result = await runAura(workspace, [
      'agent',
      '-g',
      buildEditWorkflowGoal('source.txt', 'copied.txt'),
      '--max-steps',
      '1',
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(fs.existsSync(copiedPath)).toBe(false);
  });

  it('completes a bounded multi-step file workflow through the default agent entrypoint', async () => {
    const sourceToken = `AURA_AGENT_SOURCE_${Date.now()}`;
    const { copiedPath, untouchedPath, untouchedContent } = seedEditWorkflow(
      workspace,
      sourceToken,
    );

    const result = await runAura(workspace, [
      'agent',
      '-g',
      buildEditWorkflowGoal('source.txt', 'copied.txt'),
      '--max-steps',
      '4',
    ]);

    expectExitCode(result, 0);
    expect(fs.readFileSync(copiedPath, 'utf-8')).toContain(sourceToken);
    expect(fs.readFileSync(untouchedPath, 'utf-8')).toBe(untouchedContent);
  });

  it('produces the same workspace side effects with and without the daemon entrypoint', async () => {
    const sourceToken = `AURA_AGENT_PARITY_SOURCE_${Date.now()}`;
    const noDaemonWorkspace = await createSystemWorkspace(
      'agent-goal-no-daemon',
      requireSystemLlmConfig(),
    );

    try {
      const daemonSeed = seedEditWorkflow(workspace, sourceToken);
      const localSeed = seedEditWorkflow(noDaemonWorkspace, sourceToken);
      const args = [
        'agent',
        '-g',
        buildEditWorkflowGoal('source.txt', 'copied.txt'),
        '--max-steps',
        '4',
      ];

      const daemonResult = await runAura(workspace, args);
      const localResult = await runAura(noDaemonWorkspace, [
        ...args,
        '--no-daemon',
      ]);

      expectExitCode(daemonResult, 0);
      expectExitCode(localResult, 0);

      expect(fs.readFileSync(daemonSeed.copiedPath, 'utf-8')).toContain(
        sourceToken,
      );
      expect(fs.readFileSync(localSeed.copiedPath, 'utf-8')).toContain(
        sourceToken,
      );
      expect(fs.readFileSync(daemonSeed.untouchedPath, 'utf-8')).toBe(
        daemonSeed.untouchedContent,
      );
      expect(fs.readFileSync(localSeed.untouchedPath, 'utf-8')).toBe(
        localSeed.untouchedContent,
      );
    } finally {
      await noDaemonWorkspace.cleanup();
    }
  });
});

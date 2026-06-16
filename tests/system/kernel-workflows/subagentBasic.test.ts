import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  auraBinPath,
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
  final: Record<string, unknown>;
}

function installWorkspaceAuraWrapper(workspace: SystemWorkspace): void {
  const repoRoot = path.resolve(path.dirname(auraBinPath), '../..');
  const tsxCliPath = path.join(
    repoRoot,
    'node_modules',
    'tsx',
    'dist',
    'cli.mjs',
  );
  const binDir = path.join(workspace.root, 'bin');
  const wrapperPath = path.join(binDir, 'aura');

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    wrapperPath,
    [
      '#!/usr/bin/env sh',
      `exec node ${JSON.stringify(tsxCliPath)} ${JSON.stringify(auraBinPath)} "$@"`,
      '',
    ].join('\n'),
    'utf-8',
  );
  fs.chmodSync(wrapperPath, 0o755);
}

describeSystem('System subagent workflow', { timeout: 240000 }, () => {
  let workspace: SystemWorkspace;

  beforeEach(async () => {
    workspace = await createSystemWorkspace(
      'subagent-basic',
      requireSystemLlmConfig(),
    );
    installWorkspaceAuraWrapper(workspace);
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it('runs a bounded child agent and persists subagent status', async () => {
    const token = `AURA_SUBAGENT_${Date.now()}`;
    const subagentPrefix = `system_child_${Date.now()}`;

    const result = await runAura(
      workspace,
      [
        'kernel',
        'loop',
        '-g',
        [
          'Use the subagent tool exactly once.',
          `Set subagent_id to ${subagentPrefix}.`,
          `Set max_steps to 2 and timeout to 90.`,
          `The subagent goal is: reply with only this exact token: ${token}.`,
          'After the subagent returns, finish with a concise final answer.',
        ].join(' '),
        '--max-steps',
        '3',
      ],
      { timeout: 240_000 },
    );

    expect(result.exitCode).toBe(0);

    const payload = parseJsonOutput<KernelLoopOutput>(result.stdout);
    const subagentStep = payload.steps.find((step) => step.tool === 'subagent');
    expect(subagentStep).toBeTruthy();
    expect(subagentStep?.status).toBe('success');
    expect(subagentStep?.output).toContain(token);

    const subagentsRoot = path.join(
      workspace.auraDir,
      'state',
      'subagents',
      'root',
    );
    expect(fs.existsSync(subagentsRoot)).toBe(true);

    const childDirName = fs
      .readdirSync(subagentsRoot)
      .find((entry) => entry.startsWith(subagentPrefix));
    expect(childDirName).toBeTruthy();

    const childDir = path.join(subagentsRoot, childDirName || '');
    const statusPath = path.join(childDir, 'status.json');
    const reportPath = path.join(childDir, 'report.md');

    expect(fs.existsSync(statusPath)).toBe(true);
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8')) as {
      status?: string;
      report?: string;
      summary?: string;
    };
    expect(status.status).toBe('success');
    expect(`${status.report || ''}\n${status.summary || ''}`).toContain(token);
    expect(fs.existsSync(reportPath)).toBe(true);
    expect(fs.readFileSync(reportPath, 'utf-8')).toContain(token);
  });
});

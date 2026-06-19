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
    output?: string;
  }>;
}

describeSystem('System workspace search grounding', { timeout: 180000 }, () => {
  let workspace: SystemWorkspace;

  beforeEach(async () => {
    workspace = await createSystemWorkspace(
      'workspace-search',
      requireSystemLlmConfig(),
    );
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it('uses workspace search to find and report a seeded token', async () => {
    const token = `AURA_SEARCH_${Date.now()}`;
    const docsDir = path.join(workspace.root, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(
      path.join(docsDir, 'alpha.md'),
      'Alpha notes contain no system token.\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(docsDir, 'beta.md'),
      `Beta notes contain the exact token ${token} for search grounding.\n`,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(workspace.root, 'gamma.txt'),
      'Gamma notes are unrelated.\n',
      'utf-8',
    );

    const result = await runAura(workspace, [
      'kernel',
      'loop',
      '-g',
      [
        'Use workspace_grep to search the workspace for the token that starts with AURA_SEARCH_.',
        'Do not guess from memory; use the search tool.',
        'Finish by replying with only the exact token you found.',
      ].join(' '),
      '--max-steps',
      '3',
    ]);

    expect(result.exitCode).toBe(0);

    const payload = parseJsonOutput<KernelLoopOutput>(result.stdout);
    const searchStep = payload.steps.find(
      (step) => step.tool === 'workspace_grep',
    );
    expect(searchStep).toBeTruthy();
    expect(searchStep?.output || '').toContain(token);
  });

  it('finds the exact token among similar decoy matches', async () => {
    const exactToken = `AURA_SEARCH_EXACT_${Date.now()}`;
    const decoyPrefix = exactToken.replace('_EXACT_', '_DECOY_');
    const docsDir = path.join(workspace.root, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(
      path.join(docsDir, 'alpha.md'),
      `Alpha mentions near misses ${decoyPrefix}_ONE and ${decoyPrefix}_TWO.\n`,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(docsDir, 'beta.md'),
      `Beta contains the exact target token ${exactToken} and should be the only correct answer.\n`,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(docsDir, 'gamma.md'),
      `Gamma mentions another similar string ${decoyPrefix}_THREE.\n`,
      'utf-8',
    );

    const result = await runAura(workspace, [
      'kernel',
      'loop',
      '-g',
      [
        `Use the tool named \`workspace_grep\` with query exactly "${exactToken}".`,
        'The tool name must be exactly `workspace_grep`, not a different search tool name.',
        'The workspace also contains similar decoy strings, so do not guess or call any other search tool.',
        'Finish by replying with only the relative file path that contains the exact token.',
      ].join(' '),
      '--max-steps',
      '3',
    ]);

    expect(result.exitCode).toBe(0);

    const payload = parseJsonOutput<KernelLoopOutput>(result.stdout);
    const searchStep = payload.steps.find(
      (step) => step.tool === 'workspace_grep',
    );
    expect(searchStep).toBeTruthy();
    expect(searchStep?.output || '').toContain(exactToken);
    expect(searchStep?.output || '').toContain('docs/beta.md');
    expect(searchStep?.output || '').not.toContain(decoyPrefix);
  });
});

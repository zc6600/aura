import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import yaml from 'yaml';
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
    reason?: string;
    steps?: number;
  };
}

describeSystem('System loop aborts on tool errors', { timeout: 120000 }, () => {
  let workspace: SystemWorkspace;

  beforeEach(async () => {
    workspace = await createSystemWorkspace(
      'loop-tool-error-abort',
      requireSystemLlmConfig(),
    );
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it('fails fast when max_tool_errors=1 and a tool returns status=failed', async () => {
    const rawConfig =
      yaml.parse(fs.readFileSync(workspace.configPath, 'utf-8')) || {};
    rawConfig.system = {
      ...(rawConfig.system || {}),
      max_tool_errors: 1,
    };
    fs.writeFileSync(workspace.configPath, yaml.stringify(rawConfig), 'utf-8');

    const result = await runAura(workspace, [
      'kernel',
      'loop',
      '-g',
      "You must call bash_command to run exactly: false. Don't call any other tool.",
      '--max-steps',
      '2',
    ]);

    expect(result.exitCode).toBe(0);

    const payload = parseJsonOutput<KernelLoopOutput>(result.stdout);
    expect(payload.steps.length).toBeGreaterThanOrEqual(1);
    expect(payload.steps.some((s) => s.tool === 'bash_command')).toBe(true);
    expect(payload.steps.some((s) => s.status === 'failed')).toBe(true);
    expect(payload.final?.status).toBe('failed');
    expect(payload.final?.reason || '').toMatch(/max tool errors/i);
  });
});

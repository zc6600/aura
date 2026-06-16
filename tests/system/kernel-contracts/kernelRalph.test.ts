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

interface KernelRalphOutput {
  status: 'completed' | 'failed';
  final: string | null;
}

describeSystem('System kernel Ralph contract', { timeout: 240000 }, () => {
  let workspace: SystemWorkspace;

  beforeEach(async () => {
    workspace = await createSystemWorkspace(
      'kernel-ralph',
      requireSystemLlmConfig(),
    );
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it('runs Ralph through the kernel CLI and emits machine-readable status', async () => {
    const token = `AURA_KERNEL_RALPH_${Date.now()}`;

    const result = await runAura(workspace, [
      'kernel',
      'ralph',
      '-g',
      `Reply with only this exact token and do not call tools: ${token}`,
      '--max-steps',
      '2',
    ]);

    expect(result.exitCode).toBe(0);
    const payload = parseJsonOutput<KernelRalphOutput>(result.stdout);
    expect(payload.status).toBe('completed');
    expect(payload.final || '').toContain(token);
    expect(fs.existsSync(path.join(workspace.root, 'task.md'))).toBe(true);
  });

  it('runs Ralph verification command through the kernel CLI', async () => {
    const token = `AURA_KERNEL_RALPH_VERIFY_${Date.now()}`;

    const result = await runAura(workspace, [
      'kernel',
      'ralph',
      '-g',
      `Reply with only this exact token and do not call tools: ${token}`,
      '--verify',
      'test -f task.md',
      '--max-steps',
      '2',
    ]);

    expect(result.exitCode).toBe(0);
    const payload = parseJsonOutput<KernelRalphOutput>(result.stdout);
    expect(payload.status).toBe('completed');
    expect(payload.final || '').toContain(token);
  });
});

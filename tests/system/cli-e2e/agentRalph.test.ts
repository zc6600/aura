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

describeSystem('System agent Ralph CLI', { timeout: 240000 }, () => {
  let workspace: SystemWorkspace;

  beforeEach(async () => {
    workspace = await createSystemWorkspace(
      'agent-ralph',
      requireSystemLlmConfig(),
    );
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it('runs Ralph through the default agent entrypoint with a passing verify command', async () => {
    const token = `AURA_AGENT_RALPH_${Date.now()}`;

    const result = await runAura(
      workspace,
      [
        'agent',
        '--mode',
        'ralph',
        '-g',
        `Reply with only this exact token and do not call tools: ${token}`,
        '--verify',
        'test -f task.md',
        '--max-steps',
        '2',
      ],
      { timeout: 240_000 },
    );

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(workspace.root, 'task.md'))).toBe(true);
    expect(result.stdout).toContain('Ralph Loop Success');
    expect(result.stdout).toContain(token);
  });

  it('fails clearly when Ralph verification does not pass', async () => {
    const token = `AURA_AGENT_RALPH_FAIL_${Date.now()}`;

    const result = await runAura(
      workspace,
      [
        'agent',
        '--mode',
        'ralph',
        '-g',
        `Reply with only this exact token and do not call tools: ${token}`,
        '--verify',
        'exit 1',
        '--max-steps',
        '2',
      ],
      { timeout: 240_000 },
    );

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/failed/i);
  });

  it('runs Ralph through the local no-daemon entrypoint with a passing verify command', async () => {
    const token = `AURA_AGENT_RALPH_LOCAL_${Date.now()}`;

    const result = await runAura(
      workspace,
      [
        'agent',
        '--mode',
        'ralph',
        '--no-daemon',
        '-g',
        `Reply with only this exact token and do not call tools: ${token}`,
        '--verify',
        'test -f task.md',
        '--max-steps',
        '2',
      ],
      { timeout: 240_000 },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Ralph Loop Success');
    expect(result.stdout).toContain(token);
  });

  it('fails clearly when local no-daemon Ralph verification does not pass', async () => {
    const token = `AURA_AGENT_RALPH_LOCAL_FAIL_${Date.now()}`;

    const result = await runAura(
      workspace,
      [
        'agent',
        '--mode',
        'ralph',
        '--no-daemon',
        '-g',
        `Reply with only this exact token and do not call tools: ${token}`,
        '--verify',
        'exit 1',
        '--max-steps',
        '2',
      ],
      { timeout: 240_000 },
    );

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/failed/i);
  });

  it('rejects ralph mode without a goal in local no-daemon mode', async () => {
    const result = await runAura(workspace, [
      'agent',
      '--mode',
      'ralph',
      '--no-daemon',
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'Ralph Loop requires an autonomous goal',
    );
  });
});

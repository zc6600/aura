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

describeSystem(
  'System context-aware read and modify',
  { timeout: 180000 },
  () => {
    let workspace: SystemWorkspace;

    beforeEach(async () => {
      workspace = await createSystemWorkspace(
        'context-read-modify',
        requireSystemLlmConfig(),
      );
    });

    afterEach(async () => {
      await workspace.cleanup();
    });

    it('reads a seeded file before updating the requested token only', async () => {
      const originalToken = `AURA_ORIGINAL_${Date.now()}`;
      const updatedToken = `AURA_UPDATED_${Date.now()}`;
      const targetPath = path.join(workspace.root, 'notes.txt');
      const untouchedPath = path.join(workspace.root, 'untouched.txt');
      const untouchedContent = `do not edit ${originalToken}\n`;

      fs.writeFileSync(
        targetPath,
        [
          `title: system context test`,
          `token: ${originalToken}`,
          'status: draft',
        ].join('\n'),
        'utf-8',
      );
      fs.writeFileSync(untouchedPath, untouchedContent, 'utf-8');

      const result = await runAura(workspace, [
        'kernel',
        'loop',
        '-g',
        [
          'First use read_file to inspect notes.txt.',
          `Then use write_file to replace only ${originalToken} with ${updatedToken} in notes.txt.`,
          'Do not edit untouched.txt.',
          'After the file update succeeds, finish with a concise final answer.',
        ].join(' '),
        '--max-steps',
        '4',
      ]);

      expect(result.exitCode).toBe(0);

      const payload = parseJsonOutput<KernelLoopOutput>(result.stdout);
      expect(payload.steps.some((step) => step.tool === 'read_file')).toBe(
        true,
      );
      expect(payload.steps.some((step) => step.tool === 'write_file')).toBe(
        true,
      );

      const targetContent = fs.readFileSync(targetPath, 'utf-8');
      expect(targetContent).toContain(updatedToken);
      expect(targetContent).not.toContain(originalToken);
      expect(targetContent).toContain('status: draft');
      expect(fs.readFileSync(untouchedPath, 'utf-8')).toBe(untouchedContent);
    });
  },
);

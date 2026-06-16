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
  'System tool self-discovery workflow',
  { timeout: 180000 },
  () => {
    let workspace: SystemWorkspace;

    beforeEach(async () => {
      workspace = await createSystemWorkspace(
        'tool-self-discovery',
        requireSystemLlmConfig(),
      );
    });

    afterEach(async () => {
      await workspace.cleanup();
    });

    it('inspects a tool before using it for a file side effect', async () => {
      const token = `AURA_INSPECT_${Date.now()}`;
      const outputPath = path.join(workspace.root, 'inspected-tool-output.txt');

      const result = await runAura(workspace, [
        'kernel',
        'loop',
        '-g',
        [
          'First use inspect_tool to inspect the write_file tool.',
          'Then use write_file to create inspected-tool-output.txt.',
          `The file content must contain exactly this token: ${token}.`,
          'After the file is written, finish with a concise final answer.',
        ].join(' '),
        '--max-steps',
        '4',
      ]);

      expect(result.exitCode).toBe(0);

      const payload = parseJsonOutput<KernelLoopOutput>(result.stdout);
      const tools = payload.steps.map((step) => step.tool);
      expect(tools).toContain('inspect_tool');
      expect(tools).toContain('write_file');
      expect(tools.indexOf('inspect_tool')).toBeLessThan(
        tools.indexOf('write_file'),
      );

      expect(fs.existsSync(outputPath)).toBe(true);
      expect(fs.readFileSync(outputPath, 'utf-8')).toContain(token);
    });
  },
);

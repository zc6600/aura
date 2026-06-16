import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
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
  'System knowledge database workflow',
  { timeout: 180000 },
  () => {
    let workspace: SystemWorkspace;

    beforeEach(async () => {
      workspace = await createSystemWorkspace(
        'knowledge-db',
        requireSystemLlmConfig(),
      );
    });

    afterEach(async () => {
      await workspace.cleanup();
    });

    it('stores and retrieves a unique fact through the knowledge_db tool', async () => {
      const dbName = `system_knowledge_${Date.now()}`;
      const token = `AURA_KNOWLEDGE_${Date.now()}`;
      const fact = `The system knowledge roundtrip token is ${token}.`;

      const result = await runAura(workspace, [
        'kernel',
        'loop',
        '-g',
        [
          'Use the knowledge_db tool for this task.',
          `First create database ${dbName}.`,
          `Then save this exact text with tag system-test: ${fact}`,
          `Then search ${dbName} for ${token} using keyword retrieval and top_k 1.`,
          'After the search succeeds, finish with a concise final answer containing the token.',
        ].join(' '),
        '--max-steps',
        '5',
      ]);

      expect(result.exitCode).toBe(0);

      const payload = parseJsonOutput<KernelLoopOutput>(result.stdout);
      expect(payload.steps.some((step) => step.tool === 'knowledge_db')).toBe(
        true,
      );

      const dbPath = path.join(workspace.root, 'knowledge', `${dbName}.db`);
      expect(fs.existsSync(dbPath)).toBe(true);

      const db = new Database(dbPath, { readonly: true });
      try {
        const row = db
          .prepare(
            'SELECT content, tag FROM documents ORDER BY id DESC LIMIT 1',
          )
          .get() as { content?: string; tag?: string } | undefined;

        expect(row?.content).toContain(token);
        expect(row?.tag).toBe('system-test');
      } finally {
        db.close();
      }
    });
  },
);

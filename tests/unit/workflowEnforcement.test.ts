import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RalphLoop } from '../../src/core/kernel/ralphLoop.js';
import { Runner } from '../../src/core/kernel/runner.js';
import { loadWorkflow } from '../../src/core/workflow/manifest.js';
import { getWorkflowStatus } from '../../src/core/workflow/runner.js';
import { initializeWorkspaceInPlace } from '../../src/utils/workspaceInitializer.js';

describe('Workflow Stage and Registry Enforcement', () => {
  let tempDir = '';

  afterEach(() => {
    vi.restoreAllMocks();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('evaluates stage guard and blocks anchor_submit on failure', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-wf-enforce-'));
    await initializeWorkspaceInPlace(tempDir);

    // Create a workflow.yml with a guard
    const workflowPath = path.join(tempDir, 'workflow.yml');
    fs.writeFileSync(
      workflowPath,
      `
version: 1
name: test-workflow
stages:
  - id: submit_guard
    title: Submission Format Guard
    anchor: anchors/01_guard.json
    guard:
      tool: aura.csv.validate
      args:
        target: "submissions/latest.csv"
        align_with: "data/raw/sample_submission.csv"
        rules: ["columns_match", "row_count_match"]
run:
  mode: classic
  max_steps: 10
  goal: Test guards
`,
      'utf-8',
    );

    // Write anchors/01_guard.json
    fs.mkdirSync(path.join(tempDir, 'anchors'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'anchors', '01_guard.json'),
      JSON.stringify({ id: '01_guard', description: 'Submission guard' }),
      'utf-8',
    );

    const runner = new Runner(tempDir);

    // Let's call getWorkflowStatus first. Since target files don't exist, it should list problems.
    const loaded = loadWorkflow(tempDir);
    const initialStatus = getWorkflowStatus(loaded);
    const guardStage = initialStatus.stages.find(
      (s) => s.id === 'submit_guard',
    );
    expect(guardStage).toBeDefined();
    expect(guardStage?.problems).toBeDefined();
    expect(guardStage?.problems?.[0]).toContain('CSV file missing');

    // Attempting to submit the anchor should fail because the target and sample files are missing
    const failRes = await runner.runCall({
      tool: 'anchor_submit',
      args: {
        anchor_id: '01_guard',
        summary: 'Attempting invalid submit',
      },
    });
    expect(failRes.status).toBe('failed');
    expect(failRes.error).toContain('CSV file missing');

    // Create mock sample CSV
    fs.mkdirSync(path.join(tempDir, 'data', 'raw'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'data', 'raw', 'sample_submission.csv'),
      'id,prediction\n1,0.5\n2,0.8\n',
      'utf-8',
    );

    // Create mismatched target CSV
    fs.mkdirSync(path.join(tempDir, 'submissions'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'submissions', 'latest.csv'),
      'id,pred\n1,0.5\n', // column name and row count mismatch
      'utf-8',
    );

    const mismatchRes = await runner.runCall({
      tool: 'anchor_submit',
      args: {
        anchor_id: '01_guard',
        summary: 'Attempting mismatched submit',
      },
    });
    expect(mismatchRes.status).toBe('failed');
    expect(mismatchRes.error).toContain('columns_mismatch');

    // Write correct target CSV
    fs.writeFileSync(
      path.join(tempDir, 'submissions', 'latest.csv'),
      'id,prediction\n1,0.9\n2,0.1\n',
      'utf-8',
    );

    const okRes = await runner.runCall({
      tool: 'anchor_submit',
      args: {
        anchor_id: '01_guard',
        summary: 'Perfect submit',
      },
    });
    expect(okRes.status).toBe('success');
  });

  it('runs Ralph verification on anchor_submit and updates experiments registry', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-wf-ralph-'));
    await initializeWorkspaceInPlace(tempDir);

    // Create workflow.yml with ralph stage
    fs.writeFileSync(
      path.join(tempDir, 'workflow.yml'),
      `
version: 1
name: test-ralph-workflow
registry:
  db_path: ".aura-workspace/state/experiments.db"
  metrics:
    - name: cv_score
      higher_is_better: true
stages:
  - id: verify_baseline
    title: Ralph Verification Stage
    anchor: anchors/02_verify.json
    ralph:
      verify_cmd: "node mock_verify.js"
      max_steps: 2
run:
  mode: classic
  max_steps: 10
  goal: Test ralph stages
`,
      'utf-8',
    );

    fs.mkdirSync(path.join(tempDir, 'anchors'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'anchors', '02_verify.json'),
      JSON.stringify({ id: '02_verify', description: 'Ralph verifier anchor' }),
      'utf-8',
    );

    // Write a mock run record into the registry DB first
    const runner = new Runner(tempDir);
    await runner.runCall({
      tool: 'aura.registry.record',
      args: {
        run_id: 'candidate_001',
        cv_score: 0.85,
        status: 'candidate',
      },
    });

    // Spy on RalphLoop.prototype.run to mock LLM execution loop results
    const ralphSpy = vi.spyOn(RalphLoop.prototype, 'run');

    ralphSpy.mockResolvedValueOnce({
      status: 'failed',
      run_id: 'ralph_run_001',
      goal: 'Verify stage: Ralph Verification Stage',
      iterations: 1,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      final: null,
      failure_reason: 'Failing tests',
      verification: {
        mode: 'physical',
        passed: false,
        output_tail: 'Some error',
      },
    });

    // Attempting anchor submit runs Ralph and fails
    const failRes = await runner.runCall({
      tool: 'anchor_submit',
      args: {
        anchor_id: '02_verify',
        summary: 'Try failing verification',
      },
    });
    expect(failRes.status).toBe('failed');
    expect(failRes.error).toContain('Ralph verification failed');

    ralphSpy.mockResolvedValueOnce({
      status: 'completed',
      run_id: 'ralph_run_002',
      goal: 'Verify stage: Ralph Verification Stage',
      iterations: 1,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      final: 'Verification passes',
      result_path: 'state/ralph/runs/ralph_run_002/result.json',
      verification: {
        mode: 'physical',
        passed: true,
        output_tail: 'Passed!',
      },
    });

    // Attempting anchor submit runs Ralph and passes
    const passRes = await runner.runCall({
      tool: 'anchor_submit',
      args: {
        anchor_id: '02_verify',
        summary: 'Pass verification',
      },
    });
    expect(passRes.status).toBe('success');

    // Check if the registry SQLite table is updated with the ralph_result_path
    const db = new Database(
      path.join(tempDir, '.aura-workspace/state/experiments.db'),
    );
    const row = db
      .prepare('SELECT ralph_result_path FROM runs WHERE run_id = ?')
      .get('candidate_001') as { ralph_result_path: string } | undefined;
    db.close();

    expect(row).toBeDefined();
    expect(row?.ralph_result_path).toContain('state/ralph/runs');
  });

  it('implements registry record and best tools correctly', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-wf-reg-'));
    await initializeWorkspaceInPlace(tempDir);

    fs.writeFileSync(
      path.join(tempDir, 'workflow.yml'),
      `
version: 1
name: test-reg
registry:
  db_path: "experiments/custom_experiments.db"
  metrics:
    - name: cv_score
      higher_is_better: true
run:
  mode: classic
  max_steps: 10
  goal: Test registry
`,
      'utf-8',
    );

    const runner = new Runner(tempDir);

    // Get best should return best_run: null initially
    const initBest = await runner.runCall({
      tool: 'aura.registry.best',
      args: {},
    });
    expect(initBest.status).toBe('ok');
    expect(initBest.best_run).toBeNull();

    // Record two candidate runs
    await runner.runCall({
      tool: 'aura.registry.record',
      args: {
        run_id: 'candidate_001',
        cv_score: 0.72,
        hypothesis: 'Try learning rate 0.01',
        model_family: 'xgboost',
      },
    });

    await runner.runCall({
      tool: 'aura.registry.record',
      args: {
        run_id: 'candidate_002',
        cv_score: 0.78,
        hypothesis: 'Try learning rate 0.005',
        model_family: 'xgboost',
      },
    });

    // Query best, should return candidate_002 with 0.78 score
    const bestRes = await runner.runCall({
      tool: 'aura.registry.best',
      args: {},
    });
    expect(bestRes.status).toBe('ok');
    expect(bestRes.best_run).toBeDefined();
    expect(bestRes.best_run.run_id).toBe('candidate_002');
    expect(bestRes.best_run.cv_score).toBe(0.78);
    expect(bestRes.best_run.hypothesis).toBe('Try learning rate 0.005');
  });
});

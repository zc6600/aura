import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import yaml from 'yaml';
import * as PathResolver from '../../utils/pathResolver.js';
import { AgentLoop } from '../kernel/agentLoop.js';
import { ToolRegistry } from '../kernel/registry.js';
import type { Runner } from '../kernel/runner.js';
import {
  type LoadedWorkflow,
  loadWorkflow,
  paramsPath,
  paramsSchemaPath,
} from './manifest.js';

export interface WorkflowCheck {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface WorkflowStageStatus {
  id: string;
  title?: string;
  anchor?: string;
  completed: boolean;
  problems?: string[];
}

export interface WorkflowStatus {
  workflow: LoadedWorkflow;
  checks: WorkflowCheck[];
  stages: WorkflowStageStatus[];
  params?: {
    path: string;
    exists: boolean;
    schema?: string;
    schemaExists?: boolean;
  };
}

export interface WorkflowRunOptions {
  maxSteps?: number;
  eventBus?: {
    emit: (event: string, payload?: Record<string, any>) => void;
  };
}

export function checkWorkflow(loaded: LoadedWorkflow): WorkflowCheck[] {
  const { root, manifest } = loaded;
  const checks: WorkflowCheck[] = [
    {
      label: 'workflow manifest',
      ok: fs.existsSync(loaded.path),
      detail: path.relative(root, loaded.path),
    },
  ];

  const params = paramsPath(manifest);
  if (params) {
    checks.push({
      label: 'params file',
      ok: exists(root, params),
      detail: params,
    });
  }

  const schema = paramsSchemaPath(manifest);
  if (schema) {
    checks.push({
      label: 'params schema',
      ok: exists(root, schema),
      detail: schema,
    });
  }

  const context = manifest.context || {};
  if (context.garden) {
    checks.push({
      label: 'garden playbook',
      ok: exists(root, context.garden),
      detail: context.garden,
    });
  }
  if (context.skill) {
    checks.push({
      label: 'skill',
      ok: exists(root, context.skill),
      detail: context.skill,
    });
  }
  for (const prompt of context.prompts || []) {
    checks.push({
      label: 'prompt',
      ok: exists(root, prompt),
      detail: prompt,
    });
  }

  for (const stage of manifest.stages || []) {
    if (stage.anchor) {
      checks.push({
        label: `stage anchor ${stage.id}`,
        ok: exists(root, stage.anchor),
        detail: stage.anchor,
      });
    }
  }

  let tools: string[] = [];
  try {
    tools = new ToolRegistry(root).allTools();
  } catch (_e) {}

  for (const tool of manifest.tools?.required || []) {
    checks.push({
      label: `required tool ${tool}`,
      ok: tools.includes(tool),
      detail: tool,
    });
  }

  return checks;
}

export function getWorkflowStatus(loaded: LoadedWorkflow): WorkflowStatus {
  const completedAnchors = completedAnchorIds(loaded.root);
  const stagesRaw = (loaded.manifest.stages || []).map((stage) => {
    const aid = anchorId(loaded.root, stage.anchor);
    return {
      stage,
      completed: aid ? completedAnchors.includes(aid) : false,
    };
  });

  const stages: WorkflowStageStatus[] = stagesRaw.map(
    ({ stage, completed }) => {
      const problems: string[] = [];

      if (stage.assert_files) {
        for (const file of stage.assert_files) {
          if (!exists(loaded.root, file)) {
            problems.push(`File missing: ${file}`);
          }
        }
      }

      if (completed && stage.freeze_files) {
        for (const file of stage.freeze_files) {
          if (!exists(loaded.root, file)) {
            problems.push(`Frozen file missing: ${file}`);
          }
        }
      }

      if (stage.requires) {
        for (const req of stage.requires) {
          const target = stagesRaw.find((s) => s.stage.id === req);
          if (!target) {
            problems.push(`Prerequisite stage '${req}' is not declared.`);
          } else if (!target.completed && completed) {
            problems.push(`Prerequisite stage '${req}' is not completed.`);
          }
        }
      }

      if (stage.guard) {
        if (stage.guard.tool === 'aura.csv.validate') {
          const guardRes = runCsvValidate(loaded.root, stage.guard.args || {});
          if (guardRes.status === 'failed') {
            problems.push(
              `Guard check failed: ${guardRes.error || guardRes.problems?.join(', ')}`,
            );
          }
        } else {
          problems.push(`Unsupported guard tool: ${stage.guard.tool}`);
        }
      }

      return {
        id: stage.id,
        title: stage.title,
        anchor: stage.anchor,
        completed,
        problems: problems.length > 0 ? problems : undefined,
      };
    },
  );

  const params = paramsPath(loaded.manifest);
  const schema = paramsSchemaPath(loaded.manifest);

  return {
    workflow: loaded,
    checks: checkWorkflow(loaded),
    stages,
    params: params
      ? {
          path: params,
          exists: exists(loaded.root, params),
          schema,
          schemaExists: schema ? exists(loaded.root, schema) : undefined,
        }
      : undefined,
  };
}

export function compileWorkflowGoal(loaded: LoadedWorkflow): string {
  const { manifest } = loaded;
  const lines: string[] = [];
  lines.push(`# Workflow: ${manifest.name}`);
  if (manifest.description) lines.push(manifest.description);
  lines.push('');
  lines.push(manifest.run.goal.trim());

  const params = paramsPath(manifest);
  if (params) lines.push(`\nParameters file: ${params}`);
  if (manifest.context?.garden)
    lines.push(`Garden playbook: ${manifest.context.garden}`);
  if (manifest.context?.skill)
    lines.push(`Skill procedure: ${manifest.context.skill}`);
  if (manifest.tools?.required?.length) {
    lines.push(`Required tools: ${manifest.tools.required.join(', ')}`);
  }
  if (manifest.stages?.length) {
    lines.push('\nWorkflow stages:');
    for (const stage of manifest.stages) {
      const title = stage.title ? ` - ${stage.title}` : '';
      const anchor = stage.anchor ? ` (anchor: ${stage.anchor})` : '';
      lines.push(`- ${stage.id}${title}${anchor}`);
    }
  }

  lines.push(
    '\nUse the workflow contract above as the runnable boundary. Do not bypass declared tools, stages, or verification requirements.',
  );
  return lines.join('\n');
}

export async function runWorkflow(
  runner: Runner,
  loaded: LoadedWorkflow,
  options: WorkflowRunOptions = {},
) {
  const checks = checkWorkflow(loaded);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    throw new Error(
      `Workflow '${loaded.manifest.name}' is not runnable. ${failed.length} check(s) failed.`,
    );
  }

  const goal = compileWorkflowGoal(loaded);
  runner.recordUserInput(goal);
  const agentLoop = new AgentLoop(runner, { eventBus: options.eventBus });
  return agentLoop.run(goal, {
    max_steps: options.maxSteps || loaded.manifest.run.max_steps || 30,
  });
}

function exists(root: string, relPath: string): boolean {
  return fs.existsSync(path.resolve(root, relPath));
}

export function anchorId(root: string, anchorPath?: string): string | null {
  if (!anchorPath) return null;
  const resolved = path.resolve(root, anchorPath);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    try {
      const ext = path.extname(resolved).toLowerCase();
      const raw = fs.readFileSync(resolved, 'utf-8');
      const data =
        ext === '.json'
          ? (JSON.parse(raw) as Record<string, unknown>)
          : (yaml.parse(raw) as Record<string, unknown>);
      const id = data?.id;
      if (typeof id === 'string' && id.trim()) {
        return id.trim();
      }
    } catch {
      // Fall back to the anchor filename when the file cannot be parsed.
    }
  }
  return path.basename(anchorPath, path.extname(anchorPath));
}

function completedAnchorIds(root: string): string[] {
  const dbPath = PathResolver.sessionDbPath(root);
  if (!fs.existsSync(dbPath)) return [];
  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath);
    const tableRow = db
      .prepare(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='events'",
      )
      .get() as { count: number } | undefined;
    if (!tableRow || tableRow.count === 0) return [];
    return db
      .prepare("SELECT payload FROM events WHERE tool = 'anchor_submit'")
      .all()
      .map((r: unknown) => {
        try {
          const row = r as { payload: string };
          return JSON.parse(row.payload).anchor_id;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as string[];
  } catch {
    return [];
  } finally {
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }
}

export function parseCSV(content: string): string[][] {
  const lines = content.split(/\r?\n/);
  return lines
    .map((line) => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    })
    .filter((row) => row.length > 0 && row.some((cell) => cell !== ''));
}

export function runCsvValidate(
  root: string,
  args: Record<string, any>,
): { status: 'ok' | 'failed'; error?: string; problems?: string[] } {
  const target = args.target;
  const alignWith = args.align_with;
  const rules = args.rules || [
    'columns_match',
    'row_count_match',
    'id_ordered',
    'no_missing',
  ];

  if (!target)
    return { status: 'failed', error: 'Missing target file parameter.' };
  if (!alignWith)
    return { status: 'failed', error: 'Missing align_with file parameter.' };

  const targetPath = path.resolve(root, target);
  const alignPath = path.resolve(root, alignWith);

  if (!fs.existsSync(targetPath)) {
    return { status: 'failed', error: `Target CSV file missing: ${target}` };
  }
  if (!fs.existsSync(alignPath)) {
    return { status: 'failed', error: `Sample CSV file missing: ${alignWith}` };
  }

  try {
    const targetContent = fs.readFileSync(targetPath, 'utf-8');
    const alignContent = fs.readFileSync(alignPath, 'utf-8');

    const targetRows = parseCSV(targetContent);
    const alignRows = parseCSV(alignContent);

    const problems: string[] = [];

    if (rules.includes('columns_match')) {
      const targetHeader = targetRows[0] || [];
      const alignHeader = alignRows[0] || [];
      if (JSON.stringify(targetHeader) !== JSON.stringify(alignHeader)) {
        problems.push('columns_mismatch');
      }
    }

    if (rules.includes('row_count_match')) {
      if (targetRows.length !== alignRows.length) {
        problems.push('row_count_mismatch');
      }
    }

    if (rules.includes('id_ordered')) {
      const minLength = Math.min(targetRows.length, alignRows.length);
      let mismatch = false;
      for (let i = 1; i < minLength; i++) {
        if (targetRows[i][0] !== alignRows[i][0]) {
          mismatch = true;
          break;
        }
      }
      if (mismatch || targetRows.length !== alignRows.length) {
        problems.push('id_alignment_mismatch');
      }
    }

    if (rules.includes('no_missing')) {
      let hasMissing = false;
      for (const row of targetRows) {
        if (row.some((cell) => cell === '')) {
          hasMissing = true;
          break;
        }
      }
      if (hasMissing) {
        problems.push('contains_missing_values');
      }
    }

    if (problems.length > 0) {
      return { status: 'failed', problems };
    }
    return { status: 'ok' };
  } catch (e: any) {
    return { status: 'failed', error: `CSV parsing error: ${e.message}` };
  }
}

export function getRegistryDbPath(root: string): string {
  try {
    const loaded = loadWorkflow(root);
    const reg = (loaded.manifest as any).registry;
    if (reg?.db_path) {
      return path.resolve(root, reg.db_path);
    }
  } catch {}
  return path.resolve(root, '.aura-workspace/state/experiments.db');
}

export function initRegistryDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      hypothesis TEXT,
      model_family TEXT,
      metric_name TEXT,
      cv_score REAL,
      cv_std REAL,
      higher_is_better INTEGER,
      params_json TEXT,
      changed_files_json TEXT,
      artifacts_json TEXT,
      submission_path TEXT,
      submission_sha256 TEXT,
      ralph_result_path TEXT,
      kaggle_submission_id TEXT,
      public_score REAL,
      private_score REAL,
      lb_status TEXT,
      notes TEXT
    )
  `);
  return db;
}

export function runRegistryRecord(
  root: string,
  args: Record<string, any>,
): { status: 'ok' | 'failed'; error?: string; run_id?: string } {
  const run_id = args.run_id;
  if (!run_id) {
    return { status: 'failed', error: 'Missing run_id parameter.' };
  }

  const dbPath = getRegistryDbPath(root);
  let db: Database.Database | undefined;
  try {
    db = initRegistryDb(dbPath);
    const now = new Date().toISOString();
    const payload = args;

    let higherIsBetter = payload.higher_is_better;
    let metricName = payload.metric_name;
    if (higherIsBetter === undefined || metricName === undefined) {
      try {
        const loaded = loadWorkflow(root);
        const reg = (loaded.manifest as any).registry;
        const mainMetric = reg?.metrics?.[0];
        if (mainMetric) {
          if (metricName === undefined) metricName = mainMetric.name;
          if (higherIsBetter === undefined)
            higherIsBetter = mainMetric.higher_is_better ?? true;
        }
      } catch {}
    }
    if (higherIsBetter === undefined) higherIsBetter = true;
    if (metricName === undefined) metricName = 'cv_score';

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO runs (
        run_id, created_at, status, hypothesis, model_family, metric_name,
        cv_score, cv_std, higher_is_better, params_json, changed_files_json,
        artifacts_json, submission_path, submission_sha256, ralph_result_path,
        notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      run_id,
      payload.created_at || now,
      payload.status || 'candidate',
      payload.hypothesis || null,
      payload.model_family || null,
      metricName,
      payload.cv_score !== undefined ? Number(payload.cv_score) : null,
      payload.cv_std !== undefined ? Number(payload.cv_std) : null,
      higherIsBetter ? 1 : 0,
      JSON.stringify(payload.params || {}),
      JSON.stringify(payload.changed_files || []),
      JSON.stringify(payload.artifacts || {}),
      payload.submission_path || null,
      payload.submission_sha256 || null,
      payload.ralph_result_path || null,
      payload.notes || null,
    );

    return { status: 'ok', run_id };
  } catch (e: any) {
    return { status: 'failed', error: `Failed to record run: ${e.message}` };
  } finally {
    if (db) db.close();
  }
}

export function runRegistryBest(
  root: string,
  args: Record<string, any>,
): {
  status: 'ok' | 'failed';
  error?: string;
  best_run?: any;
  message?: string;
} {
  const dbPath = getRegistryDbPath(root);
  if (!fs.existsSync(dbPath)) {
    return {
      status: 'ok',
      best_run: null,
      message: 'No runs recorded yet (registry DB does not exist).',
    };
  }

  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath);
    let metricName = args.metric_name;
    let higherIsBetter = true;

    try {
      const loaded = loadWorkflow(root);
      const reg = (loaded.manifest as any).registry;
      const mainMetric = reg?.metrics?.[0];
      if (mainMetric) {
        if (!metricName) metricName = mainMetric.name;
        higherIsBetter = mainMetric.higher_is_better ?? true;
      }
    } catch {}

    if (!metricName) metricName = 'cv_score';

    const order = higherIsBetter ? 'DESC' : 'ASC';
    const row = db
      .prepare(
        `SELECT * FROM runs WHERE metric_name = ? AND cv_score IS NOT NULL ORDER BY cv_score ${order} LIMIT 1`,
      )
      .get(metricName) as Record<string, any> | undefined;

    if (!row) {
      return {
        status: 'ok',
        best_run: null,
        message: `No runs found for metric '${metricName}'.`,
      };
    }

    const best_run = {
      ...row,
      params: JSON.parse(row.params_json || '{}'),
      changed_files: JSON.parse(row.changed_files_json || '[]'),
      artifacts: JSON.parse(row.artifacts_json || '{}'),
      higher_is_better: row.higher_is_better === 1,
    };

    return { status: 'ok', best_run };
  } catch (e: any) {
    return {
      status: 'failed',
      error: `Failed to query best run: ${e.message}`,
    };
  } finally {
    if (db) db.close();
  }
}

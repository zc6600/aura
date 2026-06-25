import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import yaml from 'yaml';
import * as PathResolver from '../../utils/pathResolver.js';
import { asRecord, errorMessage } from '../../utils/typing.js';
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
    emit: (event: string, payload?: Record<string, unknown>) => void;
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

    if (stage.ralph) {
      const verifyCmd = stage.ralph.verify_cmd?.trim() || '';
      if (!verifyCmd) {
        checks.push({
          label: `stage ralph ${stage.id}`,
          ok: false,
          detail: 'verify_cmd is empty',
        });
      } else {
        const missingRefs = missingCommandFileRefs(root, verifyCmd);
        checks.push({
          label: `stage ralph ${stage.id}`,
          ok: missingRefs.length === 0,
          detail:
            missingRefs.length > 0
              ? `missing referenced file(s): ${missingRefs.join(', ')}`
              : verifyCmd,
        });
      }
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

export function smokeWorkflow(loaded: LoadedWorkflow): WorkflowCheck[] {
  const checks = [...checkWorkflow(loaded)];
  const { root, manifest } = loaded;

  let registry: ToolRegistry | null = null;
  try {
    registry = new ToolRegistry(root);
  } catch (_e) {
    registry = null;
  }

  for (const tool of manifest.tools?.required || []) {
    const found = registry?.find(tool);
    checks.push({
      label: `tool manifest ${tool}`,
      ok: !!found,
      detail: found ? path.relative(root, found.path) : tool,
    });
    if (found) {
      const entry =
        typeof found.manifest.entry === 'string'
          ? found.manifest.entry
          : typeof found.manifest.runtime === 'object' &&
              typeof found.manifest.runtime.entry_point === 'string'
            ? found.manifest.runtime.entry_point
            : undefined;
      if (entry) {
        checks.push({
          label: `tool entry ${tool}`,
          ok: exists(found.path, entry),
          detail: path.join(path.relative(root, found.path), entry),
        });
      } else {
        checks.push({
          label: `tool entry ${tool}`,
          ok: false,
          detail: 'missing entry',
        });
      }
    }
  }

  if (manifest.registry) {
    let db: Database.Database | undefined;
    try {
      const dbPath = getRegistryDbPath(root);
      db = initRegistryDb(dbPath);
      checks.push({
        label: 'registry database',
        ok: fs.existsSync(dbPath),
        detail: path.relative(root, dbPath),
      });
    } catch (e: unknown) {
      checks.push({
        label: 'registry database',
        ok: false,
        detail: (e as Error).message,
      });
    } finally {
      if (db) db.close();
    }
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

function missingCommandFileRefs(root: string, command: string): string[] {
  const tokens = command.match(/"[^"]+"|'[^']+'|\S+/g) || [];
  const refs = tokens
    .map((token) => token.replace(/^['"]|['"]$/g, ''))
    .filter((token) => {
      if (!token || token.startsWith('-')) return false;
      if (/\s/.test(token)) return false;
      if (/^\d+(\.\d+)?$/.test(token)) return false;
      if (token.includes('{') || token.includes('}')) return false;
      if (path.isAbsolute(token)) return false;
      return token.includes('/') || /\.[A-Za-z0-9]+$/.test(token);
    });

  return refs.filter((ref) => !exists(root, ref));
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
  args: Record<string, unknown>,
): { status: 'ok' | 'failed'; error?: string; problems?: string[] } {
  const target = typeof args.target === 'string' ? args.target : '';
  const alignWith = typeof args.align_with === 'string' ? args.align_with : '';
  const rules = Array.isArray(args.rules)
    ? args.rules.map(String)
    : ['columns_match', 'row_count_match', 'id_ordered', 'no_missing'];

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
  } catch (e: unknown) {
    return { status: 'failed', error: `CSV parsing error: ${errorMessage(e)}` };
  }
}

export function getRegistryDbPath(root: string): string {
  try {
    const loaded = loadWorkflow(root);
    const reg = asRecord(asRecord(loaded.manifest).registry);
    if (typeof reg.db_path === 'string') {
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
  args: Record<string, unknown>,
): { status: 'ok' | 'failed'; error?: string; run_id?: string } {
  const run_id = typeof args.run_id === 'string' ? args.run_id : '';
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
        const reg = asRecord(asRecord(loaded.manifest).registry);
        const metrics = Array.isArray(reg.metrics) ? reg.metrics : [];
        const mainMetric = asRecord(metrics[0]);
        if (Object.keys(mainMetric).length > 0) {
          if (metricName === undefined && typeof mainMetric.name === 'string') {
            metricName = mainMetric.name;
          }
          if (higherIsBetter === undefined)
            higherIsBetter = mainMetric.higher_is_better ?? true;
        }
      } catch {}
    }
    if (higherIsBetter === undefined) higherIsBetter = true;
    if (typeof metricName !== 'string') metricName = 'cv_score';

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
      typeof payload.submission_path === 'string'
        ? payload.submission_path
        : null,
      typeof payload.submission_sha256 === 'string'
        ? payload.submission_sha256
        : null,
      typeof payload.ralph_result_path === 'string'
        ? payload.ralph_result_path
        : null,
      typeof payload.notes === 'string' ? payload.notes : null,
    );

    return { status: 'ok', run_id };
  } catch (e: unknown) {
    return {
      status: 'failed',
      error: `Failed to record run: ${errorMessage(e)}`,
    };
  } finally {
    if (db) db.close();
  }
}

export function runRegistryBest(
  root: string,
  args: Record<string, unknown>,
): {
  status: 'ok' | 'failed';
  error?: string;
  best_run?: unknown;
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
      const reg = asRecord(asRecord(loaded.manifest).registry);
      const metrics = Array.isArray(reg.metrics) ? reg.metrics : [];
      const mainMetric = asRecord(metrics[0]);
      if (Object.keys(mainMetric).length > 0) {
        if (!metricName && typeof mainMetric.name === 'string') {
          metricName = mainMetric.name;
        }
        higherIsBetter =
          typeof mainMetric.higher_is_better === 'boolean'
            ? mainMetric.higher_is_better
            : true;
      }
    } catch {}

    if (!metricName) metricName = 'cv_score';

    const order = higherIsBetter ? 'DESC' : 'ASC';
    const row = db
      .prepare(
        `SELECT * FROM runs WHERE metric_name = ? AND cv_score IS NOT NULL ORDER BY cv_score ${order} LIMIT 1`,
      )
      .get(metricName) as Record<string, unknown> | undefined;

    if (!row) {
      return {
        status: 'ok',
        best_run: null,
        message: `No runs found for metric '${metricName}'.`,
      };
    }

    const best_run = {
      ...row,
      params: JSON.parse(String(row.params_json || '{}')),
      changed_files: JSON.parse(String(row.changed_files_json || '[]')),
      artifacts: JSON.parse(String(row.artifacts_json || '{}')),
      higher_is_better: row.higher_is_better === 1,
    };

    return { status: 'ok', best_run };
  } catch (e: unknown) {
    return {
      status: 'failed',
      error: `Failed to query best run: ${errorMessage(e)}`,
    };
  } finally {
    if (db) db.close();
  }
}

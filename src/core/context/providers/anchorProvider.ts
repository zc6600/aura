import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import yaml from 'yaml';
import * as ConfigManager from '../../../utils/configManager.js';
import * as PathResolver from '../../../utils/pathResolver.js';

interface AnchorProviderOptions {
  envPath?: string;
  state?: unknown;
}

interface AnchorConfig {
  state_management?: {
    db_path?: string;
  };
}

interface AnchorNode {
  id: string;
  brief: string;
  next: string[];
}

interface AnchorProgress {
  lastCompleted?: string;
  selectedNext?: string;
  summary?: string;
  notes?: string;
  runtime?: {
    phase?: string;
    active_run_id?: string;
    active_submission_path?: string;
    active_submission_id?: string;
    resume_action?: string;
    resume_at?: string;
    tool_note?: string;
  };
}

export class AnchorProvider {
  private projectPath: string;
  private envPath: string;
  private state?: unknown;

  constructor(projectPath: string, options: AnchorProviderOptions = {}) {
    this.projectPath = path.resolve(projectPath);
    this.envPath = options.envPath || this.projectPath;
    this.state = options.state;
  }

  public provide(): string | null {
    let planText: string | null = null;
    let progress: AnchorProgress | null = null;

    // 1. Try to read from state object
    if (this.state) {
      if (
        (this.state as { store: { getVariable: (key: string) => string } })
          .store &&
        typeof (
          this.state as { store: { getVariable: (key: string) => string } }
        ).store.getVariable === 'function'
      ) {
        planText = (
          this.state as { store: { getVariable: (key: string) => string } }
        ).store.getVariable('plan');
      } else if (
        typeof (this.state as { getVariable: (key: string) => string })
          .getVariable === 'function'
      ) {
        planText = (
          this.state as { getVariable: (key: string) => string }
        ).getVariable('plan');
      } else if (
        typeof (this.state as { getFirstValue: (query: string) => string })
          .getFirstValue === 'function'
      ) {
        try {
          planText = (
            this.state as { getFirstValue: (query: string) => string }
          ).getFirstValue(
            "SELECT value FROM variables WHERE key = 'plan' LIMIT 1",
          );
        } catch (_e) {}
      }
    }

    // 2. Try to read directly from database file if not resolved yet
    let dbPath = 'state/aura.db';
    try {
      dbPath = PathResolver.sessionDbPath(this.projectPath);
    } catch (_e) {
      try {
        const config: AnchorConfig = ConfigManager.load(this.envPath) || {};
        const p = config.state_management?.db_path;
        dbPath = p
          ? path.resolve(this.envPath, p)
          : path.join(this.envPath, 'state', 'aura.db');
      } catch (_err) {
        dbPath = path.join(this.envPath, 'state', 'aura.db');
      }
    }

    if (
      planText === null &&
      fs.existsSync(dbPath) &&
      fs.statSync(dbPath).isFile()
    ) {
      let db: Database.Database | null = null;
      try {
        db = new Database(dbPath);
        const row = db
          .prepare("SELECT value FROM variables WHERE key = 'plan' LIMIT 1")
          .get() as { value: string } | undefined;
        if (row) {
          planText = String(row.value);
        }
        progress = this.readAnchorProgressFromDb(db);
      } catch (_e) {
        // Ignore errors reading database file if not initialized yet
      } finally {
        if (db) {
          try {
            db.close();
          } catch (_e) {}
        }
      }
    }

    // 3. Scan anchors/ directory
    const anchorsDir = path.join(this.projectPath, 'anchors');
    const nodes: string[] = [];
    const nodeMap = new Map<string, AnchorNode>();
    if (fs.existsSync(anchorsDir) && fs.statSync(anchorsDir).isDirectory()) {
      try {
        const files = fs.readdirSync(anchorsDir);
        for (const file of files) {
          const filePath = path.join(anchorsDir, file);
          if (!fs.statSync(filePath).isFile()) continue;

          const ext = path.extname(file).toLowerCase();
          if (ext !== '.json' && ext !== '.yaml' && ext !== '.yml') continue;

          try {
            const rawContent = fs.readFileSync(filePath, 'utf-8');
            let data: Record<string, unknown>;
            if (ext === '.json') {
              data = JSON.parse(rawContent) as Record<string, unknown>;
            } else {
              data = yaml.parse(rawContent) as Record<string, unknown>;
            }

            if (data && typeof data === 'object') {
              const id = String(data.id || path.basename(file, ext)).trim();
              const callWhen = data.call_when;
              const brief = Array.isArray(callWhen)
                ? String(callWhen[0] || '')
                : String(callWhen || '');
              const next = this.parseNextAnchors(data.next);
              const label = brief.trim() ? `: ${brief.trim()}` : '';
              nodes.push(`- ${id}${label}`);
              nodeMap.set(id, { id, brief: brief.trim(), next });
            }
          } catch (_e) {}
        }
      } catch (_e) {
        // Ignore errors reading anchors directory
      }
    }

    const lines: string[] = [];
    if (planText?.trim()) {
      lines.push(`### Overall Task\n${planText.trim()}`);
    }
    if (nodes.length > 0) {
      lines.push(`### Task Nodes\n${nodes.join('\n')}`);
      lines.push(
        [
          '### Anchor Submission Contract',
          '- When a tool returns `anchor_runtime_update`, carry it into the next `anchor_submit` call.',
          '- Keep `summary` short and focused on what the agent should remember after resume.',
          '- Use `selected_next` as a recommended next anchor, not a forced jump.',
          '- Prefer tool-provided ids and paths in runtime fields; do not invent them.',
        ].join('\n'),
      );
    }
    const currentAnchorId = progress?.selectedNext || progress?.lastCompleted;
    if (currentAnchorId) {
      const anchorProgress = progress;
      const currentNode = nodeMap.get(currentAnchorId);
      const currentLabel = currentNode?.brief
        ? `${currentAnchorId}: ${currentNode.brief}`
        : currentAnchorId;
      const progressLines = [`- Current anchor: ${currentLabel}`];
      if (anchorProgress?.lastCompleted) {
        progressLines.push(
          `- Last completed anchor: ${anchorProgress.lastCompleted}`,
        );
      }
      if (anchorProgress?.selectedNext) {
        progressLines.push(
          `- Recommended next anchor: ${anchorProgress.selectedNext}`,
        );
      }
      lines.push(`### Anchor Progress\n${progressLines.join('\n')}`);

      const runtimeLines: string[] = [];
      if (anchorProgress?.summary) {
        runtimeLines.push(`- Agent summary: ${anchorProgress.summary}`);
      }
      if (anchorProgress?.notes) {
        runtimeLines.push(`- Notes: ${anchorProgress.notes}`);
      }
      if (anchorProgress?.runtime?.phase) {
        runtimeLines.push(`- Phase: ${anchorProgress.runtime.phase}`);
      }
      if (anchorProgress?.runtime?.active_run_id) {
        runtimeLines.push(
          `- Active run: ${anchorProgress.runtime.active_run_id}`,
        );
      }
      if (anchorProgress?.runtime?.active_submission_path) {
        runtimeLines.push(
          `- Submission path: ${anchorProgress.runtime.active_submission_path}`,
        );
      }
      if (anchorProgress?.runtime?.active_submission_id) {
        runtimeLines.push(
          `- Submission id: ${anchorProgress.runtime.active_submission_id}`,
        );
      }
      if (anchorProgress?.runtime?.resume_action) {
        runtimeLines.push(
          `- Resume action: ${anchorProgress.runtime.resume_action}`,
        );
      }
      if (anchorProgress?.runtime?.resume_at) {
        runtimeLines.push(`- Resume at: ${anchorProgress.runtime.resume_at}`);
      }
      if (anchorProgress?.runtime?.tool_note) {
        runtimeLines.push(`- Tool note: ${anchorProgress.runtime.tool_note}`);
      }
      if (runtimeLines.length > 0) {
        lines.push(`### Anchor Runtime\n${runtimeLines.join('\n')}`);
      }

      if (currentNode?.next.length) {
        const nextLines = currentNode.next.map((nextId) => {
          const nextNode = nodeMap.get(nextId);
          const label = nextNode?.brief ? `: ${nextNode.brief}` : '';
          return `- ${nextId}${label}`;
        });
        lines.push(`### Current Anchor Next Options\n${nextLines.join('\n')}`);
      }
    }

    return lines.length > 0 ? lines.join('\n\n') : null;
  }

  private parseNextAnchors(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);
    }
    if (typeof value === 'string' && value.trim()) {
      return [value.trim()];
    }
    return [];
  }

  private readAnchorProgressFromDb(
    db: Database.Database,
  ): AnchorProgress | null {
    try {
      const row = db
        .prepare(
          "SELECT payload FROM events WHERE tool = 'anchor_submit' ORDER BY id DESC LIMIT 1",
        )
        .get() as { payload: string } | undefined;
      if (!row?.payload) {
        return null;
      }
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      const lastCompleted =
        typeof payload.anchor_id === 'string' && payload.anchor_id.trim()
          ? payload.anchor_id.trim()
          : undefined;
      const summary =
        typeof payload.summary === 'string' && payload.summary.trim()
          ? payload.summary.trim()
          : undefined;
      const notes =
        typeof payload.notes === 'string' && payload.notes.trim()
          ? payload.notes.trim()
          : undefined;
      const selectedNextRaw =
        typeof payload.selected_next === 'string' &&
        payload.selected_next.trim()
          ? payload.selected_next.trim()
          : typeof payload.next_stage === 'string' && payload.next_stage.trim()
            ? payload.next_stage.trim()
            : undefined;
      const runtime = this.parseRuntime(payload.runtime);
      if (!lastCompleted && !selectedNextRaw && !summary && !runtime) {
        return null;
      }
      return {
        lastCompleted,
        selectedNext: selectedNextRaw,
        summary,
        notes,
        runtime: runtime || undefined,
      };
    } catch {
      return null;
    }
  }

  private parseRuntime(value: unknown): AnchorProgress['runtime'] | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const raw = value as Record<string, unknown>;
    const runtime = {
      phase: this.readString(raw.phase),
      active_run_id: this.readString(raw.active_run_id),
      active_submission_path: this.readString(raw.active_submission_path),
      active_submission_id: this.readString(raw.active_submission_id),
      resume_action: this.readString(raw.resume_action),
      resume_at: this.readString(raw.resume_at),
      tool_note: this.readString(raw.tool_note),
    };
    return Object.values(runtime).some(Boolean) ? runtime : null;
  }

  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}

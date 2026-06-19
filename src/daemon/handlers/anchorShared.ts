import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { SQLiteStore } from '../../core/memory/sqliteStore.js';
import * as PathResolver from '../../utils/pathResolver.js';

export interface AnchorInfo {
  id: string;
  name?: string;
  description?: string;
  call_when?: string[];
  next?: string[];
  status: 'completed' | 'pending';
  completedAt?: string;
  summary?: string;
  notes?: string;
  selectedNext?: string;
  runtime?: AnchorRuntimeUpdate;
}

export interface AnchorRuntimeUpdate {
  phase?: string;
  active_run_id?: string;
  active_submission_path?: string;
  active_submission_id?: string;
  resume_action?: string;
  resume_at?: string;
  tool_note?: string;
}

interface CompletedAnchorInfo {
  summary: string;
  notes: string;
  selectedNext: string;
  runtime?: AnchorRuntimeUpdate;
  timestamp: number;
}

const MAX_SUMMARY_LENGTH = 300;
const MAX_NOTES_LENGTH = 200;
const MAX_RUNTIME_FIELD_LENGTH = 120;

function clampString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

export function sanitizeAnchorRuntimeUpdate(
  value: unknown,
): AnchorRuntimeUpdate | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const runtime: AnchorRuntimeUpdate = {
    phase: clampString(raw.phase, MAX_RUNTIME_FIELD_LENGTH),
    active_run_id: clampString(raw.active_run_id, MAX_RUNTIME_FIELD_LENGTH),
    active_submission_path: clampString(
      raw.active_submission_path,
      MAX_RUNTIME_FIELD_LENGTH,
    ),
    active_submission_id: clampString(
      raw.active_submission_id,
      MAX_RUNTIME_FIELD_LENGTH,
    ),
    resume_action: clampString(raw.resume_action, MAX_RUNTIME_FIELD_LENGTH),
    resume_at: clampString(raw.resume_at, MAX_RUNTIME_FIELD_LENGTH),
    tool_note: clampString(raw.tool_note, MAX_RUNTIME_FIELD_LENGTH),
  };

  return Object.values(runtime).some(Boolean) ? runtime : undefined;
}

export function sessionDbPath(
  projectPath: string,
  sessionName = 'default',
): string {
  return PathResolver.sessionDbPath(projectPath, sessionName);
}

export function loadCompletedAnchorMap(
  dbPath: string,
): Map<string, CompletedAnchorInfo> {
  const completedMap = new Map<string, CompletedAnchorInfo>();
  if (!fs.existsSync(dbPath)) {
    return completedMap;
  }

  const store = new SQLiteStore({ dbPath });
  try {
    const events = store.fetchAnchorSubmitEvents();
    for (const event of events) {
      if (event.payload.anchor_id) {
        completedMap.set(event.payload.anchor_id as string, {
          summary: (event.payload.summary as string) || '',
          notes: (event.payload.notes as string) || '',
          selectedNext:
            (event.payload.selected_next as string) ||
            (event.payload.next_stage as string) ||
            '',
          runtime: sanitizeAnchorRuntimeUpdate(event.payload.runtime),
          timestamp: event.timestamp,
        });
      }
    }
  } finally {
    store.close();
  }

  return completedMap;
}

export function listAnchors(
  projectPath: string,
  completedMap: Map<string, CompletedAnchorInfo>,
): AnchorInfo[] {
  const anchorsDir = path.join(projectPath, 'anchors');
  const anchors: AnchorInfo[] = [];

  if (!fs.existsSync(anchorsDir) || !fs.statSync(anchorsDir).isDirectory()) {
    return anchors;
  }

  const files = fs.readdirSync(anchorsDir);
  for (const file of files) {
    const full = path.join(anchorsDir, file);
    if (!fs.statSync(full).isFile()) continue;
    const ext = path.extname(file).toLowerCase();
    if (!['.json', '.yaml', '.yml'].includes(ext)) continue;

    try {
      const content = fs.readFileSync(full, 'utf-8');
      const data =
        ext === '.json'
          ? (JSON.parse(content) as Record<string, unknown>)
          : (yaml.parse(content) as Record<string, unknown>);
      const id = String(data.id || path.basename(file, ext));
      const completedInfo = completedMap.get(id);

      anchors.push({
        id,
        name: String(data.name || id),
        description: String(data.description || ''),
        call_when: Array.isArray(data.call_when)
          ? data.call_when.map((item) => String(item))
          : data.call_when
            ? [String(data.call_when)]
            : [],
        next: Array.isArray(data.next)
          ? data.next.map((item) => String(item))
          : data.next
            ? [String(data.next)]
            : [],
        status: completedInfo ? 'completed' : 'pending',
        completedAt: completedInfo
          ? new Date(completedInfo.timestamp * 1000).toISOString()
          : undefined,
        summary: completedInfo ? completedInfo.summary : undefined,
        notes: completedInfo ? completedInfo.notes : undefined,
        selectedNext: completedInfo ? completedInfo.selectedNext : undefined,
        runtime: completedInfo ? completedInfo.runtime : undefined,
      });
    } catch {
      const id = path.basename(file, ext);
      const completedInfo = completedMap.get(id);
      anchors.push({
        id,
        next: [],
        status: completedInfo ? 'completed' : 'pending',
        completedAt: completedInfo
          ? new Date(completedInfo.timestamp * 1000).toISOString()
          : undefined,
        summary: completedInfo ? completedInfo.summary : undefined,
        notes: completedInfo ? completedInfo.notes : undefined,
        selectedNext: completedInfo ? completedInfo.selectedNext : undefined,
        runtime: completedInfo ? completedInfo.runtime : undefined,
      });
    }
  }

  return anchors;
}

export function getAnchorsProgress(
  projectPath: string,
  dbPath: string,
): {
  completed: number;
  total: number;
  ratio: number;
  pending: string[];
} {
  const completedIds = Array.from(loadCompletedAnchorMap(dbPath).keys());
  const anchorsDir = path.join(projectPath, 'anchors');
  let totalAnchors = 0;
  let completedAnchors = 0;
  const pendingAnchors: string[] = [];

  if (fs.existsSync(anchorsDir) && fs.statSync(anchorsDir).isDirectory()) {
    fs.readdirSync(anchorsDir).forEach((file) => {
      const full = path.join(anchorsDir, file);
      if (!fs.statSync(full).isFile()) return;
      const ext = path.extname(file).toLowerCase();
      if (!['.json', '.yaml', '.yml'].includes(ext)) return;

      totalAnchors++;
      try {
        const content = fs.readFileSync(full, 'utf-8');
        const data =
          ext === '.json'
            ? (JSON.parse(content) as Record<string, unknown>)
            : (yaml.parse(content) as Record<string, unknown>);
        const id = String(data.id || path.basename(file, ext));
        if (completedIds.includes(id)) {
          completedAnchors++;
        } else {
          pendingAnchors.push(id);
        }
      } catch {
        pendingAnchors.push(path.basename(file, ext));
      }
    });
  }

  const ratio = totalAnchors > 0 ? (completedAnchors / totalAnchors) * 100 : 0;
  return {
    completed: completedAnchors,
    total: totalAnchors,
    ratio: Number(ratio.toFixed(1)),
    pending: pendingAnchors,
  };
}

export function submitAnchorEvent(options: {
  dbPath: string;
  anchorId: string;
  summary?: unknown;
  selectedNext?: unknown;
  notes?: unknown;
  anchorRuntimeUpdate?: unknown;
}): void {
  const store = new SQLiteStore({ dbPath: options.dbPath });
  try {
    const selectedNext = clampString(
      options.selectedNext,
      MAX_RUNTIME_FIELD_LENGTH,
    );
    const summary = clampString(options.summary, MAX_SUMMARY_LENGTH);
    const notes = clampString(options.notes, MAX_NOTES_LENGTH);
    const runtime = sanitizeAnchorRuntimeUpdate(options.anchorRuntimeUpdate);
    store.insertEvent({
      timestamp: Math.floor(Date.now() / 1000),
      phase: 'tool',
      tool: 'anchor_submit',
      payload: {
        anchor_id: options.anchorId,
        summary,
        notes,
        selected_next: selectedNext,
        next_stage: selectedNext,
        runtime,
      },
    });
  } finally {
    store.close();
  }
}

export function revokeAnchorEvents(options: {
  dbPath: string;
  anchorId: string;
}): void {
  const store = new SQLiteStore({ dbPath: options.dbPath });
  try {
    const rows = store
      .getRawDb()
      .prepare("SELECT id, payload FROM events WHERE tool = 'anchor_submit'")
      .all() as { id: number; payload: string }[];
    const toDelete: number[] = [];
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload) as Record<string, unknown>;
        if (payload.anchor_id === options.anchorId) {
          toDelete.push(row.id);
        }
      } catch {}
    }
    if (toDelete.length > 0) {
      store.deleteEvents(toDelete);
    }
  } finally {
    store.close();
  }
}

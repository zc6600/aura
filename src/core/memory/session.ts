import fs from 'node:fs';
import { MemoryProvider, type TranscriptMessage } from './provider.js';
import { MemoryRecorder } from './recorder.js';
import {
  type SessionStats,
  SQLiteStore,
  type StoredToolEvent,
} from './sqliteStore.js';

export type { SessionStats, StoredToolEvent, TranscriptMessage };

export interface TimelineOptions {
  summary_limit?: number | null;
  event_limit?: number | null;
  event_time_gap_seconds?: number;
}

/**
 * The Published Language Memory exposes to every other bounded context.
 * Nothing outside `src/core/memory/` should import SQLiteStore, better-sqlite3,
 * or reach for a raw session db file path — this interface is the only door in.
 *
 * It deliberately speaks in domain terms (turns, executions, summaries,
 * timelines) rather than SQL. `latestEventForTool`/`eventsForTool` are the
 * one generic escape hatch for features (anchors today) that ride on the
 * event log without being part of Memory's own vocabulary — Memory doesn't
 * need to know what an "anchor" is, only how to look up events by tool name.
 */
export interface MemorySession {
  readonly dbPath: string;

  // Write
  appendUserTurn(content: string): number;
  appendAssistantTurn(content: string): number;
  appendToolExecution(tool: string, result: Record<string, unknown>): number;
  appendCallSummary(text: string, forEvent: number): void;
  /** Escape hatch for events outside the user/plan/execution vocabulary (e.g. anchor submissions) — not surfaced by renderTimeline. */
  appendCustomEvent(
    phase: string,
    tool: string,
    payload: Record<string, unknown>,
  ): number;

  // Read / render
  renderTimeline(options?: TimelineOptions): string;
  chatMessages(options?: { limit?: number | null }): TranscriptMessage[];
  getVariable(key: string): string | null;
  setVariable(key: string, value: string): void;
  stats(): SessionStats;

  // Generic tool-event lookups
  latestEventForTool(tool: string): StoredToolEvent | null;
  eventsForTool(tool: string): StoredToolEvent[];
  deleteEvents(ids: number[]): void;

  // Raw tailing, for live views (the web dashboard)
  eventTail(limit: number): { id: number; payload: string }[];
  eventsSince(id: number): { id: number; payload: string }[];
  eventsByPhase(phase: string): { payload: string }[];
  distinctPhases(limit?: number): string[];

  // Lifecycle
  undoLastTurn(): boolean;
  redoLastTurn(): boolean;
  clearHistory(): void;
  close(): void;
}

export interface OpenMemorySessionConfig {
  dbPath?: string;
  projectPath?: string;
  db?: import('better-sqlite3').Database;
  /** Opens an existing session strictly read-only; the db file must already exist. */
  readonly?: boolean;
}

/** Thin MemorySession adapter over SQLiteStore, for one-shot external callers (CLI, daemon, dashboard). */
export class SqliteMemorySession implements MemorySession {
  private readonly store: SQLiteStore;
  private readonly recorder: MemoryRecorder;
  private readonly provider: MemoryProvider;

  constructor(store: SQLiteStore) {
    this.store = store;
    this.recorder = new MemoryRecorder(store);
    this.provider = new MemoryProvider(store);
  }

  public get dbPath(): string {
    return this.store.dbPath;
  }

  public appendUserTurn(content: string): number {
    return this.recorder.recordUser(content);
  }

  public appendAssistantTurn(content: string): number {
    return this.recorder.recordAssistant(content);
  }

  public appendToolExecution(
    tool: string,
    result: Record<string, unknown>,
  ): number {
    return this.recorder.recordExecution(tool, result);
  }

  public appendCallSummary(text: string, forEvent: number): void {
    this.recorder.recordSummary(text, forEvent);
  }

  public appendCustomEvent(
    phase: string,
    tool: string,
    payload: Record<string, unknown>,
  ): number {
    return this.store.insertEvent({
      timestamp: Math.floor(Date.now() / 1000),
      phase,
      tool,
      payload,
    });
  }

  public renderTimeline(options: TimelineOptions = {}): string {
    return this.provider.toMarkdown(options);
  }

  public chatMessages(
    options: { limit?: number | null } = {},
  ): TranscriptMessage[] {
    return this.provider.toChatMessages(options);
  }

  public getVariable(key: string): string | null {
    return this.store.getVariable(key);
  }

  public setVariable(key: string, value: string): void {
    this.store.setVariable(key, value);
  }

  public stats(): SessionStats {
    return this.store.sessionStats();
  }

  public latestEventForTool(tool: string): StoredToolEvent | null {
    return this.store.latestEventForTool(tool);
  }

  public eventsForTool(tool: string): StoredToolEvent[] {
    return this.store.eventsForTool(tool);
  }

  public deleteEvents(ids: number[]): void {
    this.store.deleteEvents(ids);
  }

  public eventTail(limit: number): { id: number; payload: string }[] {
    return this.store.eventTail(limit);
  }

  public eventsSince(id: number): { id: number; payload: string }[] {
    return this.store.eventsSince(id);
  }

  public eventsByPhase(phase: string): { payload: string }[] {
    return this.store.eventsByPhase(phase);
  }

  public distinctPhases(limit?: number): string[] {
    return this.store.distinctPhases(limit);
  }

  public undoLastTurn(): boolean {
    return this.store.undoLastTurn();
  }

  public redoLastTurn(): boolean {
    return this.store.redoLastTurn();
  }

  public clearHistory(): void {
    this.store.clearHistory();
  }

  public close(): void {
    this.store.close();
  }
}

/**
 * Opens a session's persisted state. This — not `new SQLiteStore(...)` — is
 * how every context outside Memory should get at a session's data.
 */
export function openMemorySession(
  config: OpenMemorySessionConfig = {},
): MemorySession {
  return new SqliteMemorySession(new SQLiteStore(config));
}

/**
 * Whether a session's db file exists on disk yet, without creating it.
 * SQLiteStore's constructor creates the file (and schema) as a side effect,
 * so callers that want to report "no session yet" must check first.
 */
export function memorySessionExists(dbPath: string): boolean {
  return fs.existsSync(dbPath);
}

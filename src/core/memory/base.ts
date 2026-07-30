import type { IEventBus } from '../events.js';
import type { MemoryConfig } from './config.js';
import { MemoryMetabolizer, type MetabolismResult } from './metabolizer.js';
import {
  MemoryPolicy,
  type RetentionConfig,
  type TierConfig,
  type ToolManifestSource,
} from './policy.js';
import { MemoryProvider, type TranscriptMessage } from './provider.js';
import { MemoryRecorder } from './recorder.js';
import type { MemorySession, TimelineOptions } from './session.js';
import type { SessionStats, StoredToolEvent } from './sqliteStore.js';
import { SQLiteStore } from './sqliteStore.js';
import { MemorySummarizer } from './summarizer.js';

/**
 * Implements MemorySession directly (on top of the recorder/provider/store
 * it already owns) so a long-lived Runner session can satisfy the same port
 * lightweight callers get from `openMemorySession()` — no separate wrapper.
 */
export class MemoryBase implements MemorySession {
  public readonly recorder: MemoryRecorder;
  public readonly provider: MemoryProvider;
  public readonly metabolizer: MemoryMetabolizer;
  public readonly store: SQLiteStore;
  public readonly config: MemoryConfig;

  constructor(options: {
    config: MemoryConfig;
    store?: SQLiteStore | null;
    eventBus?: IEventBus;
    registry?: ToolManifestSource;
  }) {
    this.config = options.config;
    this.store = options.store || this.defaultStore();

    this.recorder = new MemoryRecorder(this.store);
    this.provider = new MemoryProvider(this.store);

    const policy = new MemoryPolicy({
      tiers: this.config.retention.tiers as Record<string, TierConfig>,
      retention: this.config.retention.retention as Record<
        string,
        RetentionConfig
      >,
      registry: options.registry,
    });

    const summarizer = new MemorySummarizer(
      this.config.storeConfig.project_path || '.',
    );

    this.metabolizer = new MemoryMetabolizer({
      store: this.store,
      policy,
      summarizer,
      metabolismConfig: this.config.metabolism,
      eventBus: options.eventBus,
      registry: options.registry,
    });
  }

  public async metabolizeIfNeeded(): Promise<MetabolismResult> {
    return this.metabolizer.runIfNeeded();
  }

  public async metabolize(): Promise<MetabolismResult> {
    return this.metabolizer.run();
  }

  public undo(): boolean {
    return typeof this.store.undoLastTurn === 'function'
      ? this.store.undoLastTurn()
      : false;
  }

  public redo(): boolean {
    return typeof this.store.redoLastTurn === 'function'
      ? this.store.redoLastTurn()
      : false;
  }

  // --- MemorySession ---------------------------------------------------
  // Thin delegations to the recorder/provider/store this instance already
  // owns, so Runner's long-lived memory can be handed out anywhere a
  // MemorySession is expected instead of a raw store/db.

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
    return this.undo();
  }

  public redoLastTurn(): boolean {
    return this.redo();
  }

  public clearHistory(): void {
    this.store.clearHistory();
  }

  public close(): void {
    this.store.close();
  }

  private defaultStore(): SQLiteStore {
    const sc = this.config.storeConfig;
    return new SQLiteStore({ dbPath: sc.db_path || 'state/aura.db' });
  }
}

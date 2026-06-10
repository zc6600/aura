import type { IEventBus } from '../kernel/interfaces.js';
import type { ToolRegistry } from '../kernel/registry.js';
import { MemoryEventBus } from './eventBus.js';
import type { MemoryPolicy } from './policy.js';
import type { EventRecord as Event, SQLiteStore } from './sqliteStore.js';
import type { MemorySummarizer } from './summarizer.js';

export interface MetabolismConfig {
  max_chars?: number;
  recent_events_n?: number;
  summarization?: {
    enabled?: boolean;
    max_chars?: number;
  };
}

export interface MetabolismResult {
  total_events: number;
  candidates_for_summary: number;
  summarized: number;
  deleted: number;
  errors: number;
}

export class MemoryMetabolizer {
  private store: SQLiteStore;
  private policy: MemoryPolicy;
  private summarizer: MemorySummarizer;
  private metabolismConfig: MetabolismConfig;
  private eventBus?: MemoryEventBus;
  private registry?: ToolRegistry;

  constructor(options: {
    store: SQLiteStore;
    policy: MemoryPolicy;
    summarizer: MemorySummarizer;
    metabolismConfig?: MetabolismConfig;
    eventBus?: IEventBus;
    registry?: ToolRegistry;
  }) {
    this.store = options.store;
    this.policy = options.policy;
    this.summarizer = options.summarizer;
    this.metabolismConfig = options.metabolismConfig || {};
    this.eventBus = options.eventBus
      ? this.wrapEventBus(options.eventBus)
      : undefined;
    this.registry = options.registry;
  }

  public async runIfNeeded(): Promise<MetabolismResult> {
    const stats: MetabolismResult = {
      total_events: 0,
      candidates_for_summary: 0,
      summarized: 0,
      deleted: 0,
      errors: 0,
    };

    try {
      stats.total_events = this.store.countEvents();

      if (
        !this.shouldMetabolize() ||
        stats.total_events <= this.recentEventsN
      ) {
        return stats;
      }

      this.emit('metabolism_start', {
        event_count: stats.total_events,
        total_chars: this.store.totalEventsChars(),
      });

      const oldEvents = this.selectOldEvents();
      if (oldEvents.length === 0) {
        return stats;
      }

      const retentionResult = this.policy.apply(oldEvents);
      stats.candidates_for_summary = retentionResult.to_summarize.length;

      if (retentionResult.to_summarize.length > 0) {
        const summary = await this.generateMetabolismSummary(
          retentionResult.to_summarize,
        );
        if (summary?.trim()) {
          this.store.insertSummary({
            content: `Metabolism: Narrative Summary - ${summary}`,
          });
          stats.summarized = retentionResult.to_summarize.length;
          this.emit('metabolism_summary', { content: summary });
        }
      }

      const idsToDelete = retentionResult.to_delete
        .map((e: Event) => e.id)
        .filter(Boolean);
      if (idsToDelete.length > 0) {
        this.store.deleteEvents(idsToDelete);
        stats.deleted = idsToDelete.length;
        this.emit('metabolism_complete', { deleted_count: stats.deleted });
      }
    } catch (e: unknown) {
      stats.errors += 1;
      console.warn(`[Memory::Metabolizer] Error: ${(e as Error).message}`);
    }

    return stats;
  }

  public async run(): Promise<MetabolismResult> {
    return this.runIfNeeded();
  }

  private wrapEventBus(bus: IEventBus): MemoryEventBus {
    if (bus instanceof MemoryEventBus) {
      return bus;
    }
    return new MemoryEventBus(bus);
  }

  private shouldMetabolize(): boolean {
    const totalChars = this.store.totalEventsChars();
    const eventCount = this.store.countEvents();
    const maxChars = this.metabolismConfig.max_chars || 100000;
    const recentN = this.recentEventsN;

    return totalChars > maxChars || eventCount > recentN * 5;
  }

  private get recentEventsN(): number {
    return this.metabolismConfig.recent_events_n || 20;
  }

  private selectOldEvents(): Event[] {
    const keepRecent = this.recentEventsN;
    return this.store.fetchEvents({ offset: keepRecent });
  }

  private async generateMetabolismSummary(
    events: Event[],
  ): Promise<string | null> {
    if (!this.summarizationEnabled) {
      return null;
    }

    const maxChars = this.metabolismConfig.summarization?.max_chars || 500;
    let summary = await this.summarizer.synthesize(events);
    if (summary && summary.length > maxChars) {
      summary = summary.substring(0, maxChars);
    }
    return summary;
  }

  private get summarizationEnabled(): boolean {
    const val = this.metabolismConfig.summarization?.enabled;
    return val === undefined || val === true;
  }

  private emit(event: string, data: Record<string, unknown> = {}): void {
    this.eventBus?.emit(event, data);
  }
}

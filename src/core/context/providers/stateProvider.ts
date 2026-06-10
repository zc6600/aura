import { MemoryBase } from '../../memory/base.js';
import { MemoryProvider } from '../../memory/provider.js';
import { SQLiteStore } from '../../memory/sqliteStore.js';

interface StateProviderOptions {
  summary_limit?: number;
  event_limit?: number;
  event_time_gap_seconds?: number;
}

export class StateProvider {
  private memory?: MemoryBase | null;
  private db: unknown;
  private options: StateProviderOptions;

  constructor(db: unknown, options: StateProviderOptions = {}) {
    this.options = options || {};

    if (db instanceof MemoryBase) {
      this.memory = db;
      this.db = null;
    } else if (
      db &&
      typeof db === 'object' &&
      (db as { memory: unknown }).memory instanceof MemoryBase
    ) {
      this.memory = (db as { memory: MemoryBase }).memory;
      this.db = null;
    } else {
      this.memory = null;
      this.db = db;
    }
  }

  public provide(): string {
    // 1. Modern path
    if (this.memory) {
      return this.memory.provider.toMarkdown({
        summary_limit: this.options.summary_limit,
        event_limit: this.options.event_limit,
        event_time_gap_seconds: this.options.event_time_gap_seconds,
      });
    }

    // 2. Legacy / compatibility path: if it's already a Provider
    if (
      this.db &&
      typeof this.db === 'object' &&
      typeof (this.db as MemoryProvider).toMarkdown === 'function'
    ) {
      return (this.db as MemoryProvider).toMarkdown({
        summary_limit: this.options.summary_limit,
        event_limit: this.options.event_limit,
        event_time_gap_seconds: this.options.event_time_gap_seconds,
      });
    }

    // 2.5. If it is a raw better-sqlite3 Database instance
    if (
      this.db &&
      typeof this.db === 'object' &&
      typeof (this.db as { prepare: unknown }).prepare === 'function'
    ) {
      const store = new SQLiteStore({
        db: this.db as import('better-sqlite3').Database,
      });
      const provider = new MemoryProvider(store);
      return provider.toMarkdown({
        summary_limit: this.options.summary_limit,
        event_limit: this.options.event_limit,
        event_time_gap_seconds: this.options.event_time_gap_seconds,
      });
    }

    // 3. Fallback compatibility parsing for custom mock database interfaces
    if (
      this.db &&
      typeof this.db === 'object' &&
      typeof (this.db as { allVariables: () => void }).allVariables ===
        'function'
    ) {
      const provider = new MemoryProvider(this.db as unknown as SQLiteStore);
      return provider.toMarkdown({
        summary_limit: this.options.summary_limit,
        event_limit: this.options.event_limit,
        event_time_gap_seconds: this.options.event_time_gap_seconds,
      });
    }

    return '# AGENT STATE & MEMORY\n(No history or variables recorded yet.)';
  }
}

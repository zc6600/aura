import { MemoryBase } from '../../memory/base.js';
import { MemoryProvider } from '../../memory/provider.js';

export class StateProvider {
  private memory?: MemoryBase | null;
  private db: any;
  private options: any;

  constructor(db: any, options: any = {}) {
    this.options = options || {};

    if (db instanceof MemoryBase) {
      this.memory = db;
      this.db = null;
    } else if (db && db.memory instanceof MemoryBase) {
      this.memory = db.memory;
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
    if (this.db && typeof this.db.toMarkdown === 'function') {
      return this.db.toMarkdown({
        summary_limit: this.options.summary_limit,
        event_limit: this.options.event_limit,
        event_time_gap_seconds: this.options.event_time_gap_seconds,
      });
    }

    // 3. Fallback compatibility parsing for custom mock database interfaces
    if (this.db && typeof this.db.allVariables === 'function') {
      const provider = new MemoryProvider(this.db);
      return provider.toMarkdown({
        summary_limit: this.options.summary_limit,
        event_limit: this.options.event_limit,
        event_time_gap_seconds: this.options.event_time_gap_seconds,
      });
    }

    return '# AGENT STATE & MEMORY\n(No history or variables recorded yet.)';
  }
}

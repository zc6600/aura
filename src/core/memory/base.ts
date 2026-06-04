import { MemoryConfig } from './config.js';
import { SQLiteStore } from './sqliteStore.js';
import { MemoryRecorder } from './recorder.js';
import { MemoryProvider } from './provider.js';
import { MemoryPolicy } from './policy.js';
import { MemoryMetabolizer } from './metabolizer.js';
import { MemorySummarizer } from './summarizer.js';
import { MemoryEventBus } from './eventBus.js';

export class MemoryBase {
  public readonly recorder: MemoryRecorder;
  public readonly provider: MemoryProvider;
  public readonly metabolizer: MemoryMetabolizer;
  public readonly store: SQLiteStore;
  public readonly config: MemoryConfig;

  constructor(options: {
    config: MemoryConfig;
    store?: SQLiteStore | null;
    eventBus?: any;
    registry?: any;
  }) {
    this.config = options.config;
    this.store = options.store || this.defaultStore();

    this.recorder = new MemoryRecorder(this.store);
    this.provider = new MemoryProvider(this.store);

    const policy = new MemoryPolicy({
      tiers: this.config.retention.tiers,
      retention: this.config.retention.retention,
      registry: options.registry,
    });

    const summarizer = new MemorySummarizer(this.config.storeConfig.project_path || '.');

    this.metabolizer = new MemoryMetabolizer({
      store: this.store,
      policy,
      summarizer,
      metabolismConfig: this.config.metabolism,
      eventBus: options.eventBus,
      registry: options.registry,
    });
  }

  public async metabolizeIfNeeded(): Promise<any> {
    return this.metabolizer.runIfNeeded();
  }

  public async metabolize(): Promise<any> {
    return this.metabolizer.run();
  }

  public undo(): boolean {
    return typeof this.store.undoLastTurn === 'function' ? this.store.undoLastTurn() : false;
  }

  public redo(): boolean {
    return typeof this.store.redoLastTurn === 'function' ? this.store.redoLastTurn() : false;
  }

  private defaultStore(): SQLiteStore {
    const sc = this.config.storeConfig;
    return new SQLiteStore({ dbPath: sc.db_path || 'state/aura.db' });
  }
}

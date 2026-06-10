import type { IEventBus } from '../kernel/interfaces.js';
import type { ToolRegistry } from '../kernel/registry.js';
import type { MemoryConfig } from './config.js';
import { MemoryMetabolizer, type MetabolismResult } from './metabolizer.js';
import {
  MemoryPolicy,
  type RetentionConfig,
  type TierConfig,
} from './policy.js';
import { MemoryProvider } from './provider.js';
import { MemoryRecorder } from './recorder.js';
import { SQLiteStore } from './sqliteStore.js';
import { MemorySummarizer } from './summarizer.js';

export class MemoryBase {
  public readonly recorder: MemoryRecorder;
  public readonly provider: MemoryProvider;
  public readonly metabolizer: MemoryMetabolizer;
  public readonly store: SQLiteStore;
  public readonly config: MemoryConfig;

  constructor(options: {
    config: MemoryConfig;
    store?: SQLiteStore | null;
    eventBus?: IEventBus;
    registry?: ToolRegistry;
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

  private defaultStore(): SQLiteStore {
    const sc = this.config.storeConfig;
    return new SQLiteStore({ dbPath: sc.db_path || 'state/aura.db' });
  }
}

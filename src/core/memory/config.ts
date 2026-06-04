import fs from 'fs';
import yaml from 'yaml';

export interface RetentionTier {
  phases: string[];
  max_steps?: number;
  summarize?: boolean;
  permanent?: boolean;
}

export interface MetabolismConfig {
  max_chars: number;
  recent_events_n: number;
  keep_last_summary_n_steps: number;
  summarization?: {
    enabled?: boolean;
    max_chars?: number;
  };
}

export interface StoreConfig {
  type: 'sqlite';
  db_path?: string;
  project_path?: string;
}

export class MemoryConfig {
  public static readonly DEFAULT_METABOLISM: MetabolismConfig = {
    max_chars: 100000,
    recent_events_n: 20,
    keep_last_summary_n_steps: 20,
    summarization: {
      enabled: true,
      max_chars: 500,
    },
  };

  public static readonly DEFAULT_STORE: StoreConfig = {
    type: 'sqlite',
  };

  private raw: any;

  constructor(raw: any = {}) {
    this.raw = raw || {};
  }

  public get storeConfig(): StoreConfig {
    const store = this.raw.store || {};
    return {
      ...MemoryConfig.DEFAULT_STORE,
      ...store,
    };
  }

  public get retention(): any {
    return this.raw.retention || {};
  }

  public get summarizer(): any {
    return this.raw.summarizer || null;
  }

  public get metabolism(): MetabolismConfig {
    const meta = this.raw.metabolism || {};
    return {
      max_chars: Number(
        meta.max_chars ??
        this.raw.max_state_chars ??
        this.raw.max_chars ??
        MemoryConfig.DEFAULT_METABOLISM.max_chars
      ),
      recent_events_n: Number(
        meta.recent_events_n ??
        this.raw.recent_events_n ??
        MemoryConfig.DEFAULT_METABOLISM.recent_events_n
      ),
      keep_last_summary_n_steps: Number(
        meta.keep_last_summary_n_steps ??
        this.raw.keep_last_summary_n_steps ??
        MemoryConfig.DEFAULT_METABOLISM.keep_last_summary_n_steps
      ),
      summarization: {
        enabled: meta.summarization?.enabled ?? this.raw.summarization?.enabled ?? true,
        max_chars: Number(
          meta.summarization?.max_chars ??
          this.raw.summarization?.max_chars ??
          MemoryConfig.DEFAULT_METABOLISM.summarization?.max_chars ??
          500
        ),
      },
    };
  }

  public static fromFile(path: string): MemoryConfig {
    if (!fs.existsSync(path)) {
      return new MemoryConfig();
    }
    try {
      const content = fs.readFileSync(path, 'utf-8');
      const data = yaml.parse(content) || {};
      const memoryConfig = data.state_management || {};
      return new MemoryConfig(memoryConfig);
    } catch (e) {
      return new MemoryConfig();
    }
  }
}

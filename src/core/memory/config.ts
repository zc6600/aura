import fs from 'node:fs';
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

  private raw: Record<string, unknown>;

  constructor(raw: Record<string, unknown> = {}) {
    this.raw = raw || {};
  }

  public get storeConfig(): StoreConfig {
    const store = (this.raw.store as Record<string, unknown>) || {};
    return {
      ...MemoryConfig.DEFAULT_STORE,
      ...store,
    } as StoreConfig;
  }

  public get retention(): Record<string, unknown> {
    return (this.raw.retention as Record<string, unknown>) || {};
  }

  public get summarizer(): Record<string, unknown> | null {
    return (this.raw.summarizer as Record<string, unknown>) || null;
  }

  public get metabolism(): MetabolismConfig {
    const meta = (this.raw.metabolism as Record<string, unknown>) || {};
    return {
      max_chars: Number(
        meta.max_chars ??
          this.raw.max_state_chars ??
          this.raw.max_chars ??
          MemoryConfig.DEFAULT_METABOLISM.max_chars,
      ),
      recent_events_n: Number(
        meta.recent_events_n ??
          this.raw.recent_events_n ??
          MemoryConfig.DEFAULT_METABOLISM.recent_events_n,
      ),
      keep_last_summary_n_steps: Number(
        meta.keep_last_summary_n_steps ??
          this.raw.keep_last_summary_n_steps ??
          MemoryConfig.DEFAULT_METABOLISM.keep_last_summary_n_steps,
      ),
      summarization: {
        enabled: (() => {
          const s = meta.summarization ?? this.raw.summarization;
          if (s === false) return false;
          if (s && typeof s === 'object') {
            return (s as Record<string, unknown>).enabled !== false;
          }
          return true;
        })(),
        max_chars: Number(
          (meta.summarization as Record<string, unknown>)?.max_chars ??
            (this.raw.summarization as Record<string, unknown>)?.max_chars ??
            MemoryConfig.DEFAULT_METABOLISM.summarization?.max_chars ??
            500,
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
      const memoryConfig =
        (data as Record<string, unknown>).state_management || {};
      return new MemoryConfig(memoryConfig as Record<string, unknown>);
    } catch (_e) {
      return new MemoryConfig();
    }
  }
}

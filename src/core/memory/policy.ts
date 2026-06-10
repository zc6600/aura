import type { ToolRegistry } from '../kernel/registry.js';
import type { EventRecord as Event } from './sqliteStore.js';

export interface RetentionConfig {
  max_steps?: number;
  summarize?: boolean;
  permanent?: boolean;
  retention?: string;
}

export interface TierConfig {
  phases?: string[];
  max_steps?: number;
  summarize?: boolean;
  permanent?: boolean;
}

export class MemoryPolicy {
  public static readonly DEFAULT_TIERS: Record<string, TierConfig> = {
    ephemeral: {
      phases: ['execution', 'observe'],
      max_steps: 5,
      summarize: true,
    },
    working: { phases: ['plan', 'user'], max_steps: 50, summarize: false },
    insights: {
      phases: ['learn', 'interception'],
      max_steps: 200,
      summarize: true,
    },
    permanent: { phases: ['milestone'], permanent: true },
  };

  public static readonly DEFAULT_RETENTION: Record<string, RetentionConfig> = {
    execution: { max_steps: 5, summarize: true },
    observe: { max_steps: 3, summarize: false },
    plan: { max_steps: 50, summarize: false },
    user: { max_steps: 100, summarize: false },
    interception: { max_steps: 100, summarize: false },
    milestone: { permanent: true },
  };

  private tiers: Record<string, TierConfig>;
  private retention: Record<string, RetentionConfig>;
  private registry?: ToolRegistry;

  constructor(
    config: {
      tiers?: Record<string, TierConfig>;
      retention?: Record<string, RetentionConfig>;
      registry?: ToolRegistry;
    } = {},
  ) {
    this.tiers = config.tiers || MemoryPolicy.DEFAULT_TIERS;
    this.retention = config.retention || MemoryPolicy.DEFAULT_RETENTION;
    this.registry = config.registry;
  }

  public tierFor(event: { phase: string }): string {
    const phase = event.phase;
    for (const [tierName, tier] of Object.entries(this.tiers)) {
      if (tier.phases?.includes(phase)) {
        return tierName;
      }
    }
    return 'working';
  }

  public shouldSummarize(
    event: { phase: string; tool?: string | null },
    toolName?: string | null,
  ): boolean {
    const policy = this.getRetentionPolicy(event.phase, toolName || event.tool);
    return policy.summarize === true;
  }

  public isPermanent(
    event: { phase: string; tool?: string | null },
    toolName?: string | null,
  ): boolean {
    const policy = this.getRetentionPolicy(event.phase, toolName || event.tool);
    return policy.permanent === true;
  }

  public apply(
    events: Event[],
    toolName?: string | null,
  ): { to_summarize: Event[]; to_delete: Event[]; to_keep: Event[] } {
    const to_summarize: Event[] = [];
    const to_delete: Event[] = [];
    const to_keep: Event[] = [];

    for (const event of events) {
      const phase = event.phase;
      const tool = event.tool || toolName;
      const policy = this.getRetentionPolicy(phase, tool);

      if (policy.permanent === true) {
        to_keep.push(event);
      } else if (policy.summarize === true) {
        to_summarize.push(event);
        to_delete.push(event);
      } else {
        to_delete.push(event);
      }
    }

    return { to_summarize, to_delete, to_keep };
  }

  public getRegistry(): ToolRegistry | undefined {
    return this.registry;
  }

  public getRetentionPolicy(
    phase: string,
    toolName?: string | null,
  ): RetentionConfig {
    if (toolName && this.registry) {
      const manifestPolicy = this.getManifestRetention(toolName);
      if (manifestPolicy) {
        return manifestPolicy;
      }
    }
    return this.retention[phase] || { max_steps: 50, summarize: false };
  }

  public getManifestRetention(toolName: string): RetentionConfig | null {
    if (!this.registry) return null;
    try {
      const toolData = this.registry.find(toolName);
      if (!toolData) return null;

      const manifest = toolData.manifest;
      if (!manifest) return null;
      const memoryConfig = manifest.memory as
        | Record<string, unknown>
        | undefined;
      if (!memoryConfig) return null;

      return {
        max_steps: (memoryConfig.max_steps as number) ?? 50,
        summarize: (memoryConfig.summarize as boolean) ?? false,
        permanent: (memoryConfig.permanent as boolean) ?? false,
        retention: (memoryConfig.retention as string) ?? 'working',
      };
    } catch (_e) {
      return null;
    }
  }
}

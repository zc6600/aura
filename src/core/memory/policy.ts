export interface RetentionConfig {
  max_steps?: number;
  summarize?: boolean;
  permanent?: boolean;
  retention?: string;
}

export class MemoryPolicy {
  public static readonly DEFAULT_TIERS: Record<string, any> = {
    ephemeral: { phases: ['execution', 'observe'], max_steps: 5, summarize: true },
    working: { phases: ['plan', 'user'], max_steps: 50, summarize: false },
    insights: { phases: ['learn', 'interception'], max_steps: 200, summarize: true },
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

  private tiers: Record<string, any>;
  private retention: Record<string, RetentionConfig>;
  private registry?: any;

  constructor(config: { tiers?: Record<string, any>; retention?: Record<string, RetentionConfig>; registry?: any } = {}) {
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

  public shouldSummarize(event: { phase: string; tool?: string | null }, toolName?: string | null): boolean {
    const policy = this.getRetentionPolicy(event.phase, toolName || event.tool);
    return policy.summarize === true;
  }

  public isPermanent(event: { phase: string; tool?: string | null }, toolName?: string | null): boolean {
    const policy = this.getRetentionPolicy(event.phase, toolName || event.tool);
    return policy.permanent === true;
  }

  public apply(events: any[], toolName?: string | null): { to_summarize: any[]; to_delete: any[]; to_keep: any[] } {
    const to_summarize: any[] = [];
    const to_delete: any[] = [];
    const to_keep: any[] = [];

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

  private getRetentionPolicy(phase: string, toolName?: string | null): RetentionConfig {
    if (toolName && this.registry) {
      const manifestPolicy = this.getManifestRetention(toolName);
      if (manifestPolicy) {
        return manifestPolicy;
      }
    }
    return this.retention[phase] || { max_steps: 50, summarize: false };
  }

  private getManifestRetention(toolName: string): RetentionConfig | null {
    if (!this.registry) return null;
    try {
      const toolData = this.registry.find(toolName);
      if (!toolData) return null;

      const manifest = toolData.manifest || {};
      const memoryConfig = manifest.memory;
      if (!memoryConfig) return null;

      return {
        max_steps: memoryConfig.max_steps ?? 50,
        summarize: memoryConfig.summarize ?? false,
        permanent: memoryConfig.permanent ?? false,
        retention: memoryConfig.retention ?? 'working',
      };
    } catch (e) {
      return null;
    }
  }
}

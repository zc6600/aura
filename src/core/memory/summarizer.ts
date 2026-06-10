import type { EventRecord as Event } from './sqliteStore.js';

interface NarrativeService {
  synthesize(events: Event[]): Promise<string>;
}

export class MemorySummarizer {
  private narrativeService?: NarrativeService;
  public readonly projectPath: string;

  constructor(projectPath = '.') {
    this.projectPath = projectPath;
  }

  public setNarrativeService(service: NarrativeService) {
    this.narrativeService = service;
  }

  public async synthesize(events: Event[]): Promise<string> {
    if (events.length === 0) {
      return 'No events to summarize.';
    }

    if (
      this.narrativeService &&
      typeof this.narrativeService.synthesize === 'function'
    ) {
      try {
        return await this.narrativeService.synthesize(events);
      } catch (e: unknown) {
        return `Metabolism synthesis failed: ${(e as Error).message}. Cleared old events.`;
      }
    }

    return `Summary of ${events.length} events`;
  }
}

export class MemorySummarizer {
  private projectPath: string;
  private narrativeService?: any;

  constructor(projectPath = '.') {
    this.projectPath = projectPath;
  }

  public setNarrativeService(service: any) {
    this.narrativeService = service;
  }

  public async synthesize(events: any[]): Promise<string> {
    if (events.length === 0) {
      return 'No events to summarize.';
    }

    if (this.narrativeService && typeof this.narrativeService.synthesize === 'function') {
      try {
        return await this.narrativeService.synthesize(events);
      } catch (e: any) {
        return `Metabolism synthesis failed: ${e.message}. Cleared old events.`;
      }
    }

    return `Summary of ${events.length} events`;
  }
}

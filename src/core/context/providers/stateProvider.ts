import type { MemorySession, TimelineOptions } from '../../memory/session.js';

export class StateProvider {
  private session: MemorySession;
  private options: TimelineOptions;

  constructor(session: MemorySession, options: TimelineOptions = {}) {
    this.session = session;
    this.options = options || {};
  }

  public provide(): string {
    return this.session.renderTimeline({
      summary_limit: this.options.summary_limit,
      event_limit: this.options.event_limit,
      event_time_gap_seconds: this.options.event_time_gap_seconds,
    });
  }
}

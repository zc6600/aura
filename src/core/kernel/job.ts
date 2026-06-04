import crypto from 'crypto';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export class Job {
  public readonly id: string;
  public status: JobStatus;
  public started_at: Date | null = null;
  public ended_at: Date | null = null;
  public readonly events: number[] = [];
  public metadata: Record<string, any>;

  constructor(metadata: Record<string, any> = {}) {
    this.id = crypto.randomUUID();
    this.status = 'pending';
    this.metadata = metadata;
  }

  public start(): void {
    this.started_at = new Date();
    this.status = 'running';
  }

  public complete(): void {
    this.ended_at = new Date();
    this.status = 'completed';
  }

  public fail(error: Error | string): void {
    this.ended_at = new Date();
    this.status = 'failed';
    this.metadata.error = typeof error === 'string' ? error : error.message;
  }

  public addEvent(eventId: number): void {
    this.events.push(eventId);
  }

  public toObject(): any {
    return {
      id: this.id,
      status: this.status,
      started_at: this.started_at,
      ended_at: this.ended_at,
      events: this.events,
      metadata: this.metadata,
    };
  }
}

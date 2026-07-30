import path from 'node:path';
import { LocalInProcessSession } from './localInProcessSession.js';
import { RemoteDaemonSession } from './remoteDaemonSession.js';

export class Session {
  private projectPath: string;
  private options: Record<string, unknown>;

  constructor(projectPath: string, options: Record<string, unknown> = {}) {
    this.projectPath = path.resolve(projectPath);
    this.options = options;
  }

  public async start(): Promise<void> {
    if (!this.options['no-daemon']) {
      const daemonSession = new RemoteDaemonSession(
        this.projectPath,
        this.options,
      );
      return await daemonSession.start();
    }

    const localSession = new LocalInProcessSession(
      this.projectPath,
      this.options,
    );
    return await localSession.start();
  }
}

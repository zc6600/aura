import type { Database } from 'better-sqlite3';
import { ContextBase } from './base.js';
import type { ContextPayload } from './payload.js';

export class ContextAssembler {
  public static assemble(
    projectPath: string,
    db: Database,
    options: Record<string, unknown> = {},
  ): ContextPayload {
    const base = new ContextBase(projectPath, db, options);
    return base.assemble();
  }
}

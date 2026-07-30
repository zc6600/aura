import type { MemorySession } from '../memory/session.js';
import { ContextBase } from './base.js';
import type { ContextPayload } from './payload.js';

export class ContextAssembler {
  public static assemble(
    projectPath: string,
    session: MemorySession,
    options: Record<string, unknown> = {},
  ): ContextPayload {
    const base = new ContextBase(projectPath, session, options);
    return base.assemble();
  }
}

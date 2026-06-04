import { ContextBase } from './base.js';
import { ContextPayload } from './payload.js';

export class ContextAssembler {
  public static assemble(projectPath: string, db: any, options: any = {}): ContextPayload {
    const base = new ContextBase(projectPath, db, options);
    return base.assemble();
  }
}

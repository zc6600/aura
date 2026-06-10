import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as PathResolver from '../../utils/pathResolver.js';

export interface TtlConfig {
  turns?: number;
  seconds?: number;
  policy?: 'any' | 'all';
}

export interface ContextItem {
  type: string;
  created_at: string;
  created_turn: number;
  last_used_at: string;
  last_used_turn: number;
  data: Record<string, unknown>;
}

export class ContextManager {
  public readonly envPath: string;
  private readonly stateFile: string;
  private currentTurnVal = 0;

  constructor(projectPath: string) {
    const resolvedEnv =
      PathResolver.environmentPath(projectPath) || projectPath;
    this.envPath = path.resolve(resolvedEnv);

    const overridePath = process.env.AURA_TOOL_CONTEXTS_PATH;
    if (overridePath?.trim()) {
      this.stateFile = path.isAbsolute(overridePath)
        ? overridePath
        : path.resolve(this.envPath, overridePath);
    } else {
      this.stateFile = path.join(this.envPath, 'state', 'tool_contexts.json');
    }
  }

  public get projectPath(): string {
    return this.envPath;
  }

  public addContext(
    type: string,
    data: Record<string, unknown> = {},
    id?: string | null,
  ): string {
    const contexts = this.loadContexts();
    const actualId = id || `${type}_${crypto.randomBytes(4).toString('hex')}`;

    contexts[actualId] = {
      type,
      created_at: new Date().toISOString(),
      created_turn: this.currentTurn,
      last_used_at: new Date().toISOString(),
      last_used_turn: this.currentTurn,
      data,
    };

    this.saveContexts(contexts);
    return actualId;
  }

  public removeContext(id: string): boolean {
    const contexts = this.loadContexts();
    if (!contexts[id]) {
      return false;
    }
    delete contexts[id];
    this.saveContexts(contexts);
    return true;
  }

  public updateActivity(id: string, turn?: number | null): boolean {
    const contexts = this.loadContexts();
    const ctx = contexts[id];
    if (!ctx) {
      return false;
    }

    ctx.last_used_at = new Date().toISOString();
    if (turn !== undefined && turn !== null) {
      ctx.last_used_turn = turn;
    }
    this.saveContexts(contexts);
    return true;
  }

  public activeContexts(type?: string | null): Record<string, ContextItem> {
    const contexts = this.loadContexts();
    if (type) {
      const filtered: Record<string, ContextItem> = {};
      for (const [k, v] of Object.entries(contexts)) {
        if (v.type === type) {
          filtered[k] = v;
        }
      }
      return filtered;
    }
    return contexts;
  }

  public maintenance(
    currentTurn: number,
    ttlConfigs: Record<string, TtlConfig> = {},
  ): Record<string, ContextItem> {
    this.currentTurnVal = currentTurn;
    const contexts = this.loadContexts();
    const initialCount = Object.keys(contexts).length;

    for (const [id, ctx] of Object.entries(contexts)) {
      const ttl = ttlConfigs[ctx.type];
      if (!this.isContextActive(ctx, ttl)) {
        delete contexts[id];
      }
    }

    if (Object.keys(contexts).length !== initialCount) {
      this.saveContexts(contexts);
    }

    return contexts;
  }

  public loadContexts(): Record<string, ContextItem> {
    if (!fs.existsSync(this.stateFile)) {
      return {};
    }
    try {
      const raw = fs.readFileSync(this.stateFile, 'utf-8');
      const data = JSON.parse(raw) as { contexts: Record<string, ContextItem> };
      return data.contexts || {};
    } catch (_e) {
      return {};
    }
  }

  private saveContexts(contexts: Record<string, ContextItem>): void {
    const dir = path.dirname(this.stateFile);
    fs.mkdirSync(dir, { recursive: true });
    try {
      fs.writeFileSync(
        this.stateFile,
        JSON.stringify({ contexts }, null, 2),
        'utf-8',
      );
    } catch (e: unknown) {
      console.warn(
        `[ContextManager] Failed to save contexts: ${(e as Error).message}`,
      );
    }
  }

  private get currentTurn(): number {
    return this.currentTurnVal;
  }

  private isContextActive(ctx: ContextItem, ttlConfig?: TtlConfig): boolean {
    if (!ttlConfig || typeof ttlConfig !== 'object') {
      return true;
    }

    let passTurns = true;
    let passTime = true;

    if (ttlConfig.turns !== undefined && ttlConfig.turns !== null) {
      const ageTurns =
        this.currentTurn - (ctx.last_used_turn ?? ctx.created_turn ?? 0);
      passTurns = ageTurns < Number(ttlConfig.turns);
    }

    if (ttlConfig.seconds !== undefined && ttlConfig.seconds !== null) {
      const lastUsedAt = new Date(ctx.last_used_at || ctx.created_at).getTime();
      const ageSeconds = (Date.now() - lastUsedAt) / 1000;
      passTime = ageSeconds < Number(ttlConfig.seconds);
    }

    const policy = ttlConfig.policy || 'any';
    if (policy === 'all') {
      return passTurns || passTime;
    } else {
      return passTurns && passTime;
    }
  }
}

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { ToolRegistry } from './registry.js';
import { LSPManager } from '../ext/lsp/manager.js';
import { ExecutionEngine } from './executionEngine.js';
import { ContextManager } from '../context/manager.js';
import { Hooks } from './hooks.js';
import { Planner } from './planner.js';
import { Job } from './job.js';
import { MemoryBase } from '../memory/base.js';
import { MemoryConfig } from '../memory/config.js';
import { ContextAssembler } from '../context/assembler.js';
import * as PathResolver from '../../utils/pathResolver.js';
import { loadTyped } from '../../utils/configManager.js';
import type { AuraConfig } from '../../utils/configSchema.js';
import type { IRunner, ToolCall, ToolResult, PlanEvent, PlanResult } from './interfaces.js';

export class Runner extends EventEmitter implements IRunner {
  public readonly hooks: Hooks;
  public currentJob: Job | null = null;
  public memory: MemoryBase;
  public planner: Planner;
  public readonly projectPath: string;
  public readonly envPath: string;
  public sessionName: string;


  private registry: ToolRegistry;
  private lspManager: LSPManager;
  private engine: ExecutionEngine;
  private contextManager: ContextManager;
  private configCache: AuraConfig | null = null;
  private lastUserEventId: number | null = null;

  public static readonly IGNORED_SCAN_DIRS = [
    '.git',
    '.aura',
    'node_modules',
    '.bundle',
    'vendor/bundle',
    'tmp',
    'log',
    'coverage',
    '.next',
    '.nuxt',
    'dist',
    'build',
    '__pycache__',
    '.pytest_cache',
    '.mypy_cache',
  ];

  constructor(projectPath: string, options: { memory?: MemoryBase } = {}) {
    super();
    this.projectPath = fs.existsSync(projectPath) ? fs.realpathSync(projectPath) : path.resolve(projectPath);
    this.envPath = PathResolver.environmentPath(this.projectPath) || this.projectPath;
    this.sessionName = process.env.AURA_SESSION_NAME || 'default';

    this.registry = new ToolRegistry(this.envPath);
    this.memory = options.memory || this.defaultMemory();
    this.lspManager = new LSPManager(this.projectPath);
    this.engine = new ExecutionEngine(this.projectPath, { envPath: this.envPath, lsp_manager: this.lspManager });
    this.contextManager = new ContextManager(this.envPath);
    this.hooks = new Hooks();
    this.planner = new Planner(this.projectPath, { envPath: this.envPath });
  }

  public get workspacePath(): string {
    return this.projectPath;
  }

  public reconnectSession(sessionName: string): void {
    this.sessionName = sessionName;
    process.env.AURA_SESSION_NAME = sessionName;
    if (this.memory?.store) {
      try {
        this.memory.store.close();
      } catch (e) {}
    }
    this.memory = this.defaultMemory(sessionName);
    this.planner = new Planner(this.projectPath, { envPath: this.envPath });
    this.configCache = null;
  }

  public loadConfig(): AuraConfig {
    if (!this.configCache) {
      this.configCache = loadTyped(this.envPath);
    }
    return this.configCache;
  }

  public startJob(metadata: Record<string, any> = {}): Job {
    if (this.currentJob && this.currentJob.status === 'running') {
      throw new Error(`Runner is busy with job ${this.currentJob.id}`);
    }
    this.currentJob = new Job(metadata);
    this.currentJob.start();
    this.emit('job_start', this.currentJob.toObject());
    return this.currentJob;
  }

  public endJob(status: 'completed' | 'failed' = 'completed', error?: Error | string | null): Job | null {
    if (!this.currentJob) {
      return null;
    }
    if (status === 'failed' && error) {
      this.currentJob.fail(error);
    } else {
      this.currentJob.complete();
    }
    const job = this.currentJob;
    this.currentJob = null;
    this.emit('job_end', job.toObject());
    return job;
  }

  public async observe(): Promise<ReturnType<typeof ContextAssembler.assemble>> {
    this.memory.recorder.recordCustom('observe', {});
    await this.memory.metabolizeIfNeeded();
    return ContextAssembler.assemble(this.projectPath, this.memory, { lsp_manager: this.lspManager });
  }

  public async plan(goal?: string | null, context?: unknown): Promise<PlanResult> {
    const ctx = context || (await this.observe());

    const payload: { context: unknown; goal?: string | null } = { context: ctx, goal };
    this.hooks.run('before_planning', payload);

    const res = await this.planner.plan(payload.context, payload.goal) as PlanResult;
    this.memory.recorder.recordPlan(res);
    return res;
  }

  public async planStream(goal?: string | null, context?: unknown, onEvent?: (ev: PlanEvent) => void): Promise<PlanResult> {
    const ctx = context || (await this.observe());

    const payload: { context: unknown; goal?: string | null } = { context: ctx, goal };
    this.hooks.run('before_planning', payload);

    const res = await this.planner.planStream(payload.context, payload.goal || null, onEvent) as PlanResult;
    this.memory.recorder.recordPlan(res);
    return res;
  }

  public recordUserInput(input: string): number {
    this.lastUserEventId = this.memory.recorder.recordUser(input);
    if (this.currentJob) {
      this.currentJob.addEvent(this.lastUserEventId);
    }
    return this.lastUserEventId;
  }

  public async runCall(call: ToolCall): Promise<ToolResult> {
    const tool = call.tool;
    const args = call.args || {};
    const summary = call.summary;

    this.emit('tool_start', { tool, args, summary });

    if (!this.hooks.run('before_tool_execution', tool, args)) {
      this.emit('tool_blocked', { tool, reason: 'Hook rejected execution' });
      return { status: 'blocked', advice: 'Execution rejected by hook' };
    }

    this.emit('tool_executing', { tool });

    let res: ToolResult = { status: 'ok' };
    const dbPath = (this.memory as any)?.store?.dbPath as string | undefined;
    const modifiedFiles = await this.trackFileModifications(async () => {
      res = await this.engine.execute(tool, args, { sessionDbPath: dbPath, sessionName: this.sessionName }) as ToolResult;
    });

    const resPayload = { result: res, tool };
    this.hooks.run('after_tool_execution', resPayload);
    res = resPayload.result as ToolResult;

    if (modifiedFiles && modifiedFiles.length > 0) {
      res.modified_files = modifiedFiles;
    }

    this.emit('tool_result', { tool, result: res });

    const callSeq = this.lastUserEventId;
    const eventId = this.memory.recorder.recordExecution(tool, res, callSeq);
    if (this.currentJob) {
      this.currentJob.addEvent(eventId);
    }

    this.handleContextLifecycle(tool, args, res);

    try {
      const maxc = this.fetchCallSummaryMax();
      let s = summary ? String(summary) : '';
      if (maxc && s.length > maxc) {
        s = s.substring(0, maxc);
      }
      if (s) {
        this.memory.recorder.recordSummary(s, callSeq || eventId);
      }
    } catch (e) {}

    return res;
  }

  public undo(): boolean {
    return this.memory.undo();
  }

  public redo(): boolean {
    return this.memory.redo();
  }

  private defaultMemory(sessionName?: string): MemoryBase {
    const cfg = this.loadConfig();
    const config = new MemoryConfig({
      store: { project_path: this.envPath, db_path: PathResolver.sessionDbPath(this.projectPath, sessionName || this.sessionName) },
      metabolism: cfg.state_management ?? {},
    });
    return new MemoryBase({
      config,
      eventBus: this,
      registry: this.registry,
    });
  }

  private handleContextLifecycle(tool: string, args: any, res: any): void {
    const toolData = this.registry.find(tool);
    const manifest = toolData ? (toolData.manifest || {}) : {};

    if (manifest.creates_context) {
      const ctxType = manifest.creates_context;
      const ctxData = res && typeof res === 'object' && res.data ? res.data : {};
      const contextId = res && typeof res === 'object' ? res.context_id : null;
      if (contextId && String(contextId).trim()) {
        this.contextManager.addContext(ctxType, ctxData, String(contextId));
      } else {
        const newId = this.contextManager.addContext(ctxType, ctxData);
        if (res && typeof res === 'object') {
          res.context_id = newId;
        }
      }
    }

    if (manifest.destroys_context) {
      const destroyId = args.context_id || (res && typeof res === 'object' ? res.context_destroyed : null);
      if (destroyId && String(destroyId).trim()) {
        this.contextManager.removeContext(String(destroyId));
      }
    } else if (manifest.requires_context) {
      const useId = args.context_id;
      if (useId && String(useId).trim()) {
        this.contextManager.updateActivity(String(useId));
      }
    }
  }

  private fetchCallSummaryMax(): number | null {
    const limit = this.loadConfig().tool_protocol?.call_summary?.max_chars;
    return typeof limit === 'number' ? limit : null;
  }

  private async trackFileModifications(fn: () => Promise<void>): Promise<string[]> {
    const beforeState = this.getFileState();
    await fn();
    const afterState = this.getFileState();

    const modified: string[] = [];
    const beforeKeys = Object.keys(beforeState);
    const afterKeys = Object.keys(afterState);

    // Added files
    for (const key of afterKeys) {
      if (!beforeState[key]) {
        modified.push(key);
      } else {
        const b = beforeState[key];
        const a = afterState[key];
        if (b.mtime !== a.mtime || b.size !== a.size) {
          modified.push(key);
        }
      }
    }

    return modified
      .filter(f => f.startsWith(this.projectPath))
      .map(f => path.relative(this.projectPath, f).replace(/\\/g, '/'));
  }

  private getFileState(): Record<string, { mtime: number; size: number }> {
    const state: Record<string, { mtime: number; size: number }> = {};
    const walk = (dir: string) => {
      let children: string[] = [];
      try {
        children = fs.readdirSync(dir);
      } catch (e) {
        return;
      }
      for (const name of children) {
        const fullPath = path.join(dir, name);
        try {
          const stat = fs.statSync(fullPath);
          const relative = path.relative(this.projectPath, fullPath).replace(/\\/g, '/');

          // Skip ignored directories
          const isIgnored = Runner.IGNORED_SCAN_DIRS.some(d => relative === d || relative.startsWith(`${d}/`) || relative.includes(`/${d}/`));
          if (isIgnored) continue;

          if (stat.isDirectory()) {
            walk(fullPath);
          } else if (stat.isFile()) {
            state[fullPath] = { mtime: Math.floor(stat.mtimeMs), size: stat.size };
          }
        } catch (e) {}
      }
    };
    walk(this.projectPath);
    return state;
  }
}

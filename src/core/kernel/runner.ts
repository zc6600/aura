import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { loadTyped } from '../../utils/configManager.js';
import type { AuraConfig } from '../../utils/configSchema.js';
import * as PathResolver from '../../utils/pathResolver.js';
import { ContextAssembler } from '../context/assembler.js';
import { ContextManager } from '../context/manager.js';
import type { ContextPayload } from '../context/payload.js';
import { LSPManager } from '../ext/lsp/manager.js';
import { MemoryBase } from '../memory/base.js';
import { MemoryConfig } from '../memory/config.js';
import { ExecutionEngine } from './executionEngine.js';
import { Hooks } from './hooks.js';
import type {
  IEventBus,
  IRunner,
  PlanEvent,
  PlanResult,
  ToolCall,
  ToolResult,
} from './interfaces.js';
import { Job } from './job.js';
import { Planner } from './planner.js';
import { ToolRegistry } from './registry.js';

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
  private _autoMode: boolean = false;
  /** Optional abort signal set by the Daemon on socket disconnect. */
  public abortSignal: AbortSignal | null = null;

  public static readonly IGNORED_SCAN_DIRS = [
    '.git',
    '.aura',
    '.aura-workspace',
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
    '.venv',
    'venv',
    'env',
    '.cargo',
    'target',
    '.idea',
    '.vscode',
  ];

  constructor(
    projectPath: string,
    options: {
      memory?: MemoryBase;
      registry?: ToolRegistry;
      lspManager?: LSPManager;
      engine?: ExecutionEngine;
      contextManager?: ContextManager;
      hooks?: Hooks;
      planner?: Planner;
    } = {},
  ) {
    super();
    this.projectPath = fs.existsSync(projectPath)
      ? fs.realpathSync(projectPath)
      : path.resolve(projectPath);
    this.envPath =
      PathResolver.environmentPath(this.projectPath) || this.projectPath;
    this.sessionName = process.env.AURA_SESSION_NAME || 'default';

    this.registry = options.registry || new ToolRegistry(this.envPath);
    this.memory = options.memory || this.defaultMemory();
    this.lspManager = options.lspManager || new LSPManager(this.projectPath);
    this.engine =
      options.engine ||
      new ExecutionEngine(this.projectPath, {
        envPath: this.envPath,
        lsp_manager: this.lspManager,
      });
    this.contextManager =
      options.contextManager || new ContextManager(this.envPath);
    this.hooks = options.hooks || new Hooks();
    this.planner =
      options.planner ||
      new Planner(this.projectPath, { envPath: this.envPath });
  }

  public getRegistry(): ToolRegistry {
    return this.registry;
  }

  public getMemory(): MemoryBase {
    return this.memory;
  }

  public getLSPManager(): LSPManager {
    return this.lspManager;
  }

  public getEngine(): ExecutionEngine {
    return this.engine;
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
      } catch (_e) {}
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

  public clearConfigCache(): void {
    this.configCache = null;
  }

  public startJob(metadata: Record<string, unknown> = {}): Job {
    if (this.currentJob && this.currentJob.status === 'running') {
      throw new Error(`Runner is busy with job ${this.currentJob.id}`);
    }
    this.currentJob = new Job(metadata);
    this.currentJob.start();
    this.emit('job_start', this.currentJob.toObject());
    return this.currentJob;
  }

  public endJob(
    status: 'completed' | 'failed' = 'completed',
    error?: Error | string | null,
  ): Job | null {
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

  public async observe(): Promise<ContextPayload> {
    this.memory.recorder.recordCustom('observe', {});
    await this.memory.metabolizeIfNeeded();
    return ContextAssembler.assemble(this.projectPath, this.memory.store.db, {
      lsp_manager: this.lspManager,
    });
  }

  public async plan(
    goal?: string | null,
    context?: unknown,
  ): Promise<PlanResult> {
    const ctx = context || (await this.observe()).toMarkdown();

    const payload: { context: unknown; goal?: string | null } = {
      context: ctx,
      goal,
    };
    await this.hooks.run('before_planning', payload);

    const res = (await this.planner.plan(
      payload.context as string | ContextPayload,
      payload.goal,
    )) as PlanResult;
    this.memory.recorder.recordPlan(res);
    return res;
  }

  public async planStream(
    goal?: string | null,
    context?: unknown,
    onEvent?: (ev: PlanEvent) => void,
  ): Promise<PlanResult> {
    const ctx = context || (await this.observe()).toMarkdown();

    const payload: { context: unknown; goal?: string | null } = {
      context: ctx,
      goal,
    };
    await this.hooks.run('before_planning', payload);

    const res = (await this.planner.planStream(
      payload.context as string | ContextPayload,
      payload.goal || null,
      onEvent,
    )) as PlanResult;
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

    if (!(await this.hooks.run('before_tool_execution', tool, args))) {
      this.emit('tool_blocked', { tool, reason: 'Hook rejected execution' });
      return { status: 'blocked', advice: 'Execution rejected by hook' };
    }

    this.emit('tool_executing', { tool });

    let res: ToolResult = { status: 'ok' };
    const dbPath = this.memory.store?.dbPath;
    const modifiedFiles = await this.trackFileModifications(async () => {
      // For sleep_and_wake: inject the current abort signal so disconnects
      // cancel the sleep immediately rather than blocking for the full duration.
      const effectiveArgs: Record<string, unknown> =
        tool === 'sleep_and_wake' && this.abortSignal
          ? { ...args, __abortSignal__: this.abortSignal }
          : args;
      res = (await this.engine.execute(tool, effectiveArgs, {
        sessionDbPath: dbPath,
        sessionName: this.sessionName,
      })) as ToolResult;
    });

    const resPayload = { result: res, tool };
    await this.hooks.run('after_tool_execution', resPayload);
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
    } catch (_e) {}

    return res;
  }

  public undo(): boolean {
    return this.memory.undo();
  }

  public redo(): boolean {
    return this.memory.redo();
  }

  public toggleAuto(on: boolean): void {
    this._autoMode = on;
  }

  public get autoMode(): boolean {
    return this._autoMode;
  }

  private defaultMemory(sessionName?: string): MemoryBase {
    const cfg = this.loadConfig();
    const config = new MemoryConfig({
      store: {
        project_path: this.envPath,
        db_path: PathResolver.sessionDbPath(
          this.projectPath,
          sessionName || this.sessionName,
        ),
      },
      metabolism: cfg.state_management ?? {},
    });
    return new MemoryBase({
      config,
      eventBus: this as unknown as IEventBus,
      registry: this.registry,
    });
  }

  private handleContextLifecycle(
    tool: string,
    args: Record<string, unknown>,
    res: ToolResult,
  ): void {
    const toolData = this.registry.find(tool);
    const manifest = toolData ? toolData.manifest || {} : {};

    if (manifest.creates_context) {
      const ctxType = manifest.creates_context;
      const ctxData =
        res && typeof res === 'object' && 'data' in res && res.data
          ? (res.data as Record<string, unknown>)
          : {};
      const contextId =
        res && typeof res === 'object' && 'context_id' in res
          ? (res.context_id as string | null)
          : null;
      if (contextId && String(contextId).trim()) {
        this.contextManager.addContext(ctxType, ctxData, String(contextId));
      } else {
        const newId = this.contextManager.addContext(ctxType, ctxData);
        if (res && typeof res === 'object') {
          (res as Record<string, unknown>).context_id = newId;
        }
      }
    }

    if (manifest.destroys_context) {
      const destroyId =
        (args.context_id as string | undefined) ||
        (res && typeof res === 'object' && 'context_destroyed' in res
          ? (res.context_destroyed as string | null)
          : null);
      if (destroyId && String(destroyId).trim()) {
        this.contextManager.removeContext(String(destroyId));
      }
    } else if (manifest.requires_context) {
      const useId = args.context_id as string | undefined;
      if (useId && String(useId).trim()) {
        this.contextManager.updateActivity(String(useId));
      }
    }
  }

  private fetchCallSummaryMax(): number | null {
    const limit = this.loadConfig().tool_protocol?.call_summary?.max_chars;
    return typeof limit === 'number' ? limit : null;
  }

  private async trackFileModifications(
    fn: () => Promise<void>,
  ): Promise<string[]> {
    const beforeState = this.getFileState();
    await fn();
    const afterState = this.getFileState();

    const modified: string[] = [];
    const _beforeKeys = Object.keys(beforeState);
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
      .filter((f) => f.startsWith(this.projectPath))
      .map((f) => path.relative(this.projectPath, f).replace(/\\/g, '/'));
  }

  private getFileState(): Record<string, { mtime: number; size: number }> {
    const state: Record<string, { mtime: number; size: number }> = {};
    const walk = (dir: string) => {
      let children: string[] = [];
      try {
        children = fs.readdirSync(dir);
      } catch (_e) {
        return;
      }
      for (const name of children) {
        const fullPath = path.join(dir, name);
        try {
          const stat = fs.statSync(fullPath);
          const relative = path
            .relative(this.projectPath, fullPath)
            .replace(/\\/g, '/');

          // Skip ignored directories
          const isIgnored = Runner.IGNORED_SCAN_DIRS.some(
            (d) =>
              relative === d ||
              relative.startsWith(`${d}/`) ||
              relative.includes(`/${d}/`),
          );
          if (isIgnored) continue;

          if (stat.isDirectory()) {
            walk(fullPath);
          } else if (stat.isFile()) {
            state[fullPath] = {
              mtime: Math.floor(stat.mtimeMs),
              size: stat.size,
            };
          }
        } catch (_e) {}
      }
    };
    walk(this.projectPath);
    return state;
  }
}

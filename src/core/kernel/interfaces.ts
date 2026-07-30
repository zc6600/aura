/**
 * Core interfaces for the Aura kernel layer.
 *
 * These interfaces define the contracts between components, replacing `any` types
 * with proper TypeScript structural contracts. This enables compile-time safety,
 * better IDE support, and true mockability in tests.
 */

import type { ContextPayload } from '../context/payload.js';
import type { IEventBus } from '../events.js';
import type { CompletionOptions, LLMMessage } from '../llm/adapters/base.js';
import type { ParseResult } from '../llm/parsers/responseParser.js';
import type { ToolRegistry } from './registry.js';

/** Re-exported for existing kernel-internal call sites; canonical definition lives in ../events.js. */
export type { IEventBus };

// ---------------------------------------------------------------------------
// Tool execution types
// ---------------------------------------------------------------------------

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  summary?: string | null;
}

export interface ToolResult {
  status:
    | 'ok'
    | 'failed'
    | 'blocked'
    | 'upgrade_required'
    | 'running'
    | 'sleeping'
    | 'deferred'
    /** Same out-of-sandbox path denied `unattended_retry_threshold` times in a row — the run must stop, not retry. */
    | 'sandbox_locked';
  /** Some Python tools return success:true/false alongside status */
  success?: boolean;
  output?: string | null;
  content?: string | null;
  error?: string | null;
  advice?: string | null;
  modified_files?: string[];
  /** Present when status is 'blocked' or 'sandbox_locked' due to the sandbox path guard. */
  sandbox_violation?: {
    path: string;
    attempts: number;
    threshold: number;
  };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Planning types
// ---------------------------------------------------------------------------

export type PlanEvent =
  | { type: 'delta'; text: string }
  | { type: 'plan'; plan: ParseResult };

export type PlanResult = ParseResult & { finish_reason?: string | null };

// ---------------------------------------------------------------------------
// Workspace watcher interface
// ---------------------------------------------------------------------------

/**
 * Contract for a persistent, in-memory file-change tracker, satisfied by
 * WorkspaceWatcherService. Lets Runner query "what changed" without a full
 * recursive filesystem scan on every tool call. Optional: Runner instances
 * without one (e.g. one-shot CLI invocations) fall back to a sync scan.
 */
export interface IWorkspaceWatcher {
  /** Marks the current point in the change log; returns a token to diff from later. */
  markSnapshot(): number;
  /** Resolves to the relative paths added/changed/removed since the given snapshot. */
  getModifiedFilesSince(snapshotId: number): Promise<string[]>;
  /** Stops watching and releases resources. */
  close(): void;
}

// ---------------------------------------------------------------------------
// Hook system interface
// ---------------------------------------------------------------------------

export type HookFn = (
  ...args: unknown[]
) => boolean | undefined | Promise<boolean | undefined>;

export interface IHooks {
  register(name: string, fn: HookFn): void;
  unregister(name: string, fn: HookFn): void;
  /** Returns false if any hook explicitly returned false (blocking execution). */
  run(name: string, ...args: unknown[]): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Runner interface
// ---------------------------------------------------------------------------

/**
 * Contract for a Runner — the central orchestrator that AgentLoop and RalphLoop depend on.
 * Defining this interface allows both loops to be tested with mocks, and decouples them
 * from the concrete Runner implementation.
 */
export interface IRunner {
  readonly projectPath: string;
  readonly envPath: string;
  readonly hooks: IHooks;
  readonly sessionName?: string;

  loadConfig(): Record<string, unknown>;

  /** Assembles the current context (memory + workspace state) as a ContextPayload. */
  observe(): Promise<ContextPayload>;

  /**
   * The tool registry, if this runner has one — pass it to ContextAssembler.assemble()
   * so Tool/Skill context providers reuse it instead of scanning the tools directory
   * again. Optional so lightweight test doubles aren't required to implement it.
   */
  getRegistry?(): ToolRegistry;

  /** Single-shot planning call. */
  plan(goal?: string | null, context?: unknown): Promise<PlanResult>;

  /** Streaming planning call; calls onEvent for each token/plan delta. */
  planStream(
    goal: string | null,
    context: unknown,
    onEvent?: (ev: PlanEvent) => void,
  ): Promise<PlanResult>;

  /** Records a user-initiated input into memory and returns the event ID. */
  recordUserInput(input: string): number;

  /** Executes a tool call and records the result in memory. */
  runCall(call: ToolCall): Promise<ToolResult>;
}

/**
 * Extended runner contract required by RalphLoop, which needs access to
 * session switching, memory internals, and the planner for critic audits.
 * Concrete Runner satisfies this; keep the extra members to a minimum.
 */
export interface IRalphRunner extends IRunner {
  /** Switches the active memory session in-place. */
  reconnectSession(sessionName: string): void;
  /** The active session, for context assembly — not a raw store or db handle. */
  readonly memory: import('../memory/session.js').MemorySession | null;
  /** Direct access to the LLM planner for critic single-turn calls. */
  readonly planner: {
    readonly temp?: number;
    readonly maxTokens?: number;
    readonly client: {
      complete(
        messages: LLMMessage[],
        options: CompletionOptions,
      ): Promise<{ content?: string; raw?: unknown }>;
    };
  };
}

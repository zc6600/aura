/**
 * Core interfaces for the Aura kernel layer.
 *
 * These interfaces define the contracts between components, replacing `any` types
 * with proper TypeScript structural contracts. This enables compile-time safety,
 * better IDE support, and true mockability in tests.
 */

import type { ContextPayload } from '../context/payload.js';
import type { CompletionOptions, LLMMessage } from '../llm/adapters/base.js';
import type { ParseResult } from '../llm/parsers/responseParser.js';

// ---------------------------------------------------------------------------
// Tool execution types
// ---------------------------------------------------------------------------

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  summary?: string | null;
}

export interface ToolResult {
  status: 'ok' | 'failed' | 'blocked' | 'upgrade_required';
  /** Some Python tools return success:true/false alongside status */
  success?: boolean;
  output?: string | null;
  content?: string | null;
  error?: string | null;
  advice?: string | null;
  modified_files?: string[];
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
// Event bus interface
// ---------------------------------------------------------------------------

/** Minimal event bus contract. Satisfied by Runner (EventEmitter), MemoryEventBus, NullEventBus, etc. */
export interface IEventBus {
  emit(event: string, data?: unknown): void;
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
  /** Access to the raw memory store (for context assembly). */
  readonly memory: {
    store?: {
      db?: import('better-sqlite3').Database | null;
      dbPath?: string;
      close?(): void;
    };
    recorder: { recordCustom(phase: string, payload: unknown): void };
    metabolizeIfNeeded?(): Promise<unknown>;
  };
  /** Direct access to the LLM planner for critic single-turn calls. */
  readonly planner: {
    readonly temp?: number;
    readonly maxTokens?: number;
    readonly client: {
      complete(
        messages: LLMMessage[],
        options: CompletionOptions,
      ): Promise<{ content?: string; raw?: any }>;
    };
  };
}

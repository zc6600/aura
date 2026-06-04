/**
 * TypedEventBus — a generic, type-safe event bus.
 *
 * Replaces ad-hoc `emit(string, any)` patterns with a compile-time checked
 * event map. The concrete AuraEventBus with AuraEventMap is exported at the
 * bottom and is a drop-in replacement for the existing MemoryEventBus.
 *
 * @example
 *   const bus = new TypedEventBus<AuraEventMap>();
 *   bus.on('tool_start', ({ tool }) => console.log(tool));  // fully typed
 *   bus.emit('tool_start', { tool: 'bash_command', args: {} }); // checked
 */

import type { ToolResult } from './kernel/interfaces.js';

// ---------------------------------------------------------------------------
// Aura event map — exhaustive list of all events emitted in the system
// ---------------------------------------------------------------------------

export interface JobInfo {
  id: string;
  status: string;
  started_at?: string;
  ended_at?: string;
  [key: string]: unknown;
}

export interface AuraEventMap extends Record<string, unknown> {
  // Agent lifecycle
  'tool_start':       { tool: string; args: Record<string, unknown>; summary?: string | null };
  'tool_executing':   { tool: string };
  'tool_result':      { tool: string; result: ToolResult };
  'tool_blocked':     { tool: string; reason: string };
  'tool_halted':      { tool: string; status: string; advice?: string | null };

  // Planning
  'plan_stream_start': Record<string, never>;
  'plan_stream_end':   Record<string, never>;
  'plan_event':        { type: string; text?: string; plan?: unknown };

  // Loop events
  'thought':           { content: string };
  'final_answer':      { content: string };
  'no_response':       Record<string, never>;
  'loop_aborted':      { reason: string };

  // Ralph loop
  'ralph_start':       { goal: string; max_steps: number; verifier: string };
  'ralph_step_start':  { step: number; max_steps: number; session: string };

  // Jobs
  'job_start':         JobInfo;
  'job_end':           JobInfo;

  // General warnings
  'warning':           { message: string };
}

// ---------------------------------------------------------------------------
// TypedEventBus implementation
// ---------------------------------------------------------------------------

type Handler<T> = (data: T) => void;
type WildcardHandler = (event: string, data: unknown) => void;

export class TypedEventBus<TMap extends Record<string, unknown> = AuraEventMap> {
  private listeners = new Map<string, Array<Handler<unknown>>>();
  private wildcardListeners: WildcardHandler[] = [];

  /** Subscribe to a typed event. */
  on<K extends keyof TMap & string>(event: K, handler: (data: TMap[K]) => void): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler as Handler<unknown>);
    return this;
  }

  /** Subscribe to all events (wildcard). */
  onAny(handler: WildcardHandler): this {
    this.wildcardListeners.push(handler);
    return this;
  }

  /** Unsubscribe from a typed event. */
  off<K extends keyof TMap & string>(event: K, handler?: Handler<TMap[K]>): this {
    if (!handler) {
      this.listeners.delete(event);
      return this;
    }
    const list = this.listeners.get(event);
    if (list) {
      const idx = list.indexOf(handler as Handler<unknown>);
      if (idx !== -1) list.splice(idx, 1);
    }
    return this;
  }

  /** Emit a typed event. */
  emit<K extends keyof TMap & string>(event: K, data: TMap[K]): void {
    const list = this.listeners.get(event);
    if (list) {
      for (const h of list) {
        try { h(data); } catch { /* listeners must not crash the bus */ }
      }
    }
    for (const h of this.wildcardListeners) {
      try { h(event, data); } catch { /* same */ }
    }
  }

  /** Remove all listeners. */
  removeAllListeners(): void {
    this.listeners.clear();
    this.wildcardListeners = [];
  }
}

// ---------------------------------------------------------------------------
// Concrete AuraEventBus — singleton-friendly, backward-compatible alias
// ---------------------------------------------------------------------------

export class AuraEventBus extends TypedEventBus<AuraEventMap> {}

// ---------------------------------------------------------------------------
// Adapter: wrap a legacy untyped emitter to satisfy IEventBus
// ---------------------------------------------------------------------------

/** Allows code that still uses runner.emit() (Node EventEmitter) to be passed as IEventBus. */
export class EventEmitterAdapter {
  constructor(private readonly emitter: { emit(event: string, data?: unknown): void }) {}

  emit(event: string, data?: unknown): void {
    this.emitter.emit(event, data);
  }
}

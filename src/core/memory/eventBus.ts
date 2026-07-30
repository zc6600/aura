import { AgentEventBus, type EventEmitterLike } from '../kernel/eventBus.js';

export type { EventEmitterLike };

/**
 * MemoryEventBus inherits from AgentEventBus for backward compatibility.
 */
export class MemoryEventBus extends AgentEventBus {
  constructor(emitter?: EventEmitterLike) {
    super(emitter);
  }
}

// Alias for Minitest/Ruby compatibility
export const EventBus = MemoryEventBus;

interface Callbacks {
  on_token?: (text: string) => void;
  on_final_answer?: (content: string) => void;
  on_warning?: (message: string) => void;
}

export class CallbackEventBus {
  private callbacks: Callbacks;

  constructor(callbacks: Callbacks = {}) {
    this.callbacks = callbacks || {};
  }

  public emit(event: string, payload: Record<string, unknown> = {}): void {
    if (!this.callbacks) return;

    switch (event) {
      case 'plan_event':
        if (
          payload?.type === 'delta' &&
          typeof this.callbacks.on_token === 'function'
        ) {
          this.callbacks.on_token(
            payload.text !== undefined ? String(payload.text) : '',
          );
        }
        break;
      case 'final_answer':
        if (typeof this.callbacks.on_final_answer === 'function') {
          this.callbacks.on_final_answer(payload?.content as string);
        }
        break;
      case 'tool_halted':
        if (typeof this.callbacks.on_warning === 'function') {
          this.callbacks.on_warning(
            `Tool '${payload?.tool}' halted (${payload?.status}): ${payload?.advice || ''}`,
          );
        }
        break;
      case 'loop_aborted':
        if (typeof this.callbacks.on_warning === 'function') {
          this.callbacks.on_warning(
            `Agent loop aborted: ${payload?.reason || ''}`,
          );
        }
        break;
    }
  }
}

export class NullEventBus {
  public emit(_event: string, _payload?: Record<string, unknown>): void {}
}

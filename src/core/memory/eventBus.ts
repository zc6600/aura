export interface EventEmitterLike {
  emit(event: string, data?: Record<string, unknown>): void;
}

export class MemoryEventBus {
  private emitter?: EventEmitterLike;
  private listeners: Map<string, Array<(...args: unknown[]) => void>>;

  constructor(emitter?: EventEmitterLike) {
    this.emitter = emitter;
    this.listeners = new Map();
  }

  public subscribe(
    event: string,
    callback: (...args: unknown[]) => void,
  ): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(callback);
    return this;
  }

  public on(event: string, callback: (...args: unknown[]) => void): this {
    return this.subscribe(event, callback);
  }

  public off(event: string, callback?: (...args: unknown[]) => void): this {
    if (!callback) {
      this.listeners.delete(event);
      return this;
    }
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const idx = callbacks.indexOf(callback);
      if (idx !== -1) {
        callbacks.splice(idx, 1);
      }
    }
    return this;
  }

  public emit(event: string, data: Record<string, unknown> = {}): void {
    if (this.emitter && typeof this.emitter.emit === 'function') {
      try {
        this.emitter.emit(event, data);
      } catch (_e) {
        // Silently capture emitter errors
      }
    }

    // Call specific listeners
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(data);
        } catch (_e) {
          // Silently capture listener errors
        }
      }
    }

    // Call wildcard listeners
    const wildcardCallbacks =
      this.listeners.get('*') || this.listeners.get(':*');
    if (wildcardCallbacks) {
      for (const cb of wildcardCallbacks) {
        try {
          cb(event, data);
        } catch (_e) {
          // Silently capture listener errors
        }
      }
    }
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

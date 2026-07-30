export interface EventEmitterLike {
  emit(event: string, data?: Record<string, unknown>): void;
}

/**
 * AgentEventBus is the central runtime event bus for handling Agent execution,
 * LLM streaming tokens, tool invocation, thoughts, and UI interaction events.
 */
export class AgentEventBus {
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

  public once(event: string, callback: (...args: unknown[]) => void): this {
    const wrapper = (...args: unknown[]) => {
      this.off(event, wrapper);
      callback(...args);
    };
    return this.subscribe(event, wrapper);
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

import type { HookFn, IHooks } from './interfaces.js';

export class Hooks implements IHooks {
  private hookMap: Record<string, HookFn[]> = {};

  public register(name: string, hookFn: HookFn): void {
    if (!this.hookMap[name]) {
      this.hookMap[name] = [];
    }
    this.hookMap[name].push(hookFn);
  }

  public unregister(name: string, hookFn: HookFn): void {
    if (!this.hookMap[name]) return;
    const idx = this.hookMap[name].indexOf(hookFn);
    if (idx !== -1) {
      this.hookMap[name].splice(idx, 1);
    }
  }

  /**
   * Runs all hooks registered under `name`.
   * Returns false if any synchronous hook explicitly returned false (blocking).
   * Async hooks are fire-and-forget from the perspective of the return value.
   */
  public run(name: string, ...args: unknown[]): boolean {
    const list = this.hookMap[name];
    if (!list) return true;

    for (const hook of list) {
      const result = hook(...args);
      if (result === false) {
        return false;
      }
    }
    return true;
  }
}

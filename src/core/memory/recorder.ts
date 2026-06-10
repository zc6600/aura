import type { ParseResult } from '../llm/parsers/responseParser.js';
import type { SQLiteStore } from './sqliteStore.js';

export class MemoryRecorder {
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  public recordUser(content: string, callSeq?: number | null): number {
    const payload = { content, call_seq: callSeq, phase: 'user' };
    return this.store.insertEvent({
      timestamp: Math.floor(Date.now() / 1000),
      phase: 'user',
      tool: '',
      payload,
    });
  }

  public recordPlan(plan: ParseResult): number | null {
    if (!plan || typeof plan !== 'object') {
      return null;
    }

    const planData: Record<string, unknown> = {
      tool: plan.type === 'tool_call' ? plan.tool : null,
      args: plan.type === 'tool_call' ? plan.args : {},
      summary: plan.type === 'tool_call' ? plan.summary : null,
      thought: plan.thought ?? (plan.type === 'text' ? plan.content : null),
      phase: 'plan',
    };

    // Copy any extra attributes
    for (const [key, value] of Object.entries(plan)) {
      if (
        !['tool', 'args', 'summary', 'thought', 'type', 'phase'].includes(key)
      ) {
        planData[key] = value;
      }
    }

    return this.store.insertEvent({
      timestamp: Math.floor(Date.now() / 1000),
      phase: 'plan',
      tool: planData.tool as string,
      payload: planData,
    });
  }

  public recordExecution(
    toolName: string,
    result: Record<string, unknown>,
    callSeq?: number | null,
  ): number {
    const resultPayload =
      result && typeof result === 'object' && !Array.isArray(result)
        ? result
        : { output: String(result) };
    const payload = {
      result: resultPayload,
      call_seq: callSeq,
      phase: 'execution',
      tool: toolName,
    };
    return this.store.insertEvent({
      timestamp: Math.floor(Date.now() / 1000),
      phase: 'execution',
      tool: toolName,
      payload,
    });
  }

  public recordInterception(
    toolName: string,
    advice: string,
    reason?: string | null,
  ): number {
    const payload: Record<string, unknown> = {
      advice,
      phase: 'interception',
      tool: toolName,
    };
    if (reason) {
      payload.reason = reason;
    }
    return this.store.insertEvent({
      timestamp: Math.floor(Date.now() / 1000),
      phase: 'interception',
      tool: toolName,
      payload,
    });
  }

  public recordCustom(
    phase: string,
    payload: Record<string, unknown> = {},
  ): number {
    const tool = payload.tool ?? null;
    const cleanPayload = { ...payload, phase, tool };
    return this.store.insertEvent({
      timestamp: Math.floor(Date.now() / 1000),
      phase,
      tool: tool as string,
      payload: cleanPayload,
    });
  }

  public recordSummary(content: string, sourceEventId?: number | null): number {
    return this.store.insertSummary({
      content,
      source_event_id: sourceEventId ?? null,
    });
  }

  public recordBatch(events: Record<string, unknown>[]): void {
    this.store.transaction(() => {
      for (const event of events) {
        const type = event.type ?? event.phase;
        switch (type) {
          case 'user':
            this.recordUser(event.content as string, event.call_seq as number);
            break;
          case 'plan':
            this.recordPlan(
              (event.plan ?? event.plan_data ?? event) as ParseResult,
            );
            break;
          case 'execution':
            this.recordExecution(
              String(event.tool ?? event.tool_name ?? ''),
              (event.result as Record<string, unknown>) || {},
              event.call_seq as number,
            );
            break;
          case 'interception':
            this.recordInterception(
              String(event.tool ?? event.tool_name ?? ''),
              String(event.advice ?? ''),
              String(event.reason ?? ''),
            );
            break;
          default: {
            const { type: _, ...rest } = event;
            this.recordCustom(type as string, rest);
            break;
          }
        }
      }
    });
  }
}

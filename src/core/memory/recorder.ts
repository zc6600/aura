export class MemoryRecorder {
  private store: any;

  constructor(store: any) {
    this.store = store;
  }

  public recordUser(content: string, callSeq?: number | null): number {
    const payload = { content, call_seq: callSeq, phase: 'user' };
    return this.store.insertEvent({
      timestamp: Math.floor(Date.now() / 1000),
      phase: 'user',
      tool: null,
      payload,
    });
  }

  public recordPlan(plan: any): number | null {
    if (!plan || typeof plan !== 'object') {
      return null;
    }

    const planData: Record<string, any> = {
      tool: plan.tool ?? null,
      args: plan.args ?? {},
      summary: plan.summary ?? null,
      thought: plan.thought ?? plan.content ?? null,
      phase: 'plan',
    };

    // Copy any extra attributes
    for (const [key, value] of Object.entries(plan)) {
      if (!['tool', 'args', 'summary', 'thought', 'type', 'phase'].includes(key)) {
        planData[key] = value;
      }
    }

    return this.store.insertEvent({
      timestamp: Math.floor(Date.now() / 1000),
      phase: 'plan',
      tool: planData.tool,
      payload: planData,
    });
  }

  public recordExecution(toolName: string, result: any, callSeq?: number | null): number {
    const resultPayload = result && typeof result === 'object' && !Array.isArray(result) ? result : { output: String(result) };
    const payload = { result: resultPayload, call_seq: callSeq, phase: 'execution', tool: toolName };
    return this.store.insertEvent({
      timestamp: Math.floor(Date.now() / 1000),
      phase: 'execution',
      tool: toolName,
      payload,
    });
  }

  public recordInterception(toolName: string, advice: string, reason?: string | null): number {
    const payload: Record<string, any> = { advice, phase: 'interception', tool: toolName };
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

  public recordCustom(phase: string, payload: any = {}): number {
    const tool = payload.tool ?? null;
    const cleanPayload = { ...payload, phase, tool };
    return this.store.insertEvent({
      timestamp: Math.floor(Date.now() / 1000),
      phase,
      tool,
      payload: cleanPayload,
    });
  }

  public recordSummary(content: string, sourceEventId?: number | null): number {
    return this.store.insertSummary({
      content,
      source_event_id: sourceEventId ?? null,
    });
  }

  public recordBatch(events: any[]): void {
    this.store.transaction(() => {
      for (const event of events) {
        const type = event.type ?? event.phase;
        switch (type) {
          case 'user':
            this.recordUser(event.content, event.call_seq);
            break;
          case 'plan':
            this.recordPlan(event.plan ?? event.plan_data ?? event);
            break;
          case 'execution':
            this.recordExecution(event.tool ?? event.tool_name, event.result, event.call_seq);
            break;
          case 'interception':
            this.recordInterception(event.tool ?? event.tool_name, event.advice, event.reason);
            break;
          default:
            const { type: _, ...rest } = event;
            this.recordCustom(type, rest);
            break;
        }
      }
    });
  }
}

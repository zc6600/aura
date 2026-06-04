import { Planner } from './planner.js';
import { ParseResult } from '../llm/parsers/responseParser.js';
import type { IRunner, IEventBus, ToolCall, ToolResult } from './interfaces.js';

export interface AgentLoopResult {
  status: 'completed' | 'failed';
  final_content?: string | null;
  steps: Array<{ tool: string; args: Record<string, unknown>; summary?: string | null; result: ToolResult }>;
  failure_reason?: string | null;
}

export class AgentLoop {
  private runner: IRunner;
  private eventBus: IEventBus;

  constructor(runner: IRunner, options: { eventBus?: IEventBus } = {}) {
    this.runner = runner;
    this.eventBus = options.eventBus || { emit: () => {} };
  }

  public async run(goal: string, options: { ctx?: string | null; max_steps?: number | null } = {}): Promise<AgentLoopResult> {
    const cfg = typeof this.runner.loadConfig === 'function' ? this.runner.loadConfig() : {};
    const limitSteps = (options.max_steps as number | undefined) || (cfg.system as any)?.max_steps || 30;
    const maxFmtErrs = (cfg.system as any)?.max_format_errors || 5;
    const maxToolErrs = (cfg.system as any)?.max_tool_errors || 3;

    if (goal && goal.trim() && typeof this.runner.recordUserInput === 'function') {
      this.runner.recordUserInput(goal);
    }

    let ctx = options.ctx || (await this.observe());
    let formatErrors = 0;
    let toolErrors = 0;
    const steps: AgentLoopResult['steps'] = [];
    let stepCount = 0;

    while (true) {
      if (stepCount >= limitSteps) {
        const reason = `Max execution steps reached (${limitSteps})`;
        this.eventBus.emit('loop_aborted', { reason });
        return { status: 'failed', steps, failure_reason: reason };
      }

      // 1. Plan step
      const plan = await this.callPlanner(goal, ctx);
      const finishReason = String(plan.finish_reason || '');

      // 2. Check stop conditions
      if (finishReason === 'stop') {
        const content = this.extractStopContent(plan);
        this.eventBus.emit('final_answer', { content });
        return { status: 'completed', final_content: content, steps, failure_reason: null };
      }

      if (['length', 'content_filter', 'error'].includes(finishReason)) {
        const reason = `Loop terminated due to finish_reason: ${finishReason}`;
        this.eventBus.emit('loop_aborted', { reason });
        return { status: 'failed', steps, failure_reason: reason };
      }

      // 3. Validate tool call format
      // Note: check both typed ToolCallResult and legacy plain objects that have a 'tool' field
      const planTool = plan.type === 'tool_call' ? plan.tool : (plan as any).tool as string | undefined;
      if (!planTool) {
        formatErrors++;
        const thought = plan.type === 'text' ? plan.content : (plan as any).thought;
        if (thought && thought.trim()) {
          this.eventBus.emit('thought', { content: thought });
        } else {
          this.eventBus.emit('no_response', {});
        }

        if (formatErrors >= maxFmtErrs) {
          this.eventBus.emit('loop_aborted', { reason: 'format_errors' });
          return { status: 'failed', steps, failure_reason: `Max format errors reached (${maxFmtErrs})` };
        }
        ctx = this.injectFormatError(ctx);
        continue;
      }

      // Emit thought
      const thought = (plan as any).thought;
      if (thought && thought.trim()) {
        this.eventBus.emit('thought', { content: thought });
      }

      const toolName = planTool;
      formatErrors = 0;

      // 4. Act step
      stepCount++;
      const result = await this.executeTool(plan);
      steps.push({
        tool: toolName,
        args: (plan as any).args || {},
        summary: (plan as any).summary ?? null,
        result,
      });

      const status = String(result.status || '');
      if (['blocked', 'upgrade_required', 'failed'].includes(status)) {
        toolErrors++;
        this.eventBus.emit('tool_halted', { tool: toolName, status, advice: result.advice ?? null });
        if (toolErrors >= maxToolErrs) {
          this.eventBus.emit('loop_aborted', { reason: 'tool_errors' });
          return { status: 'failed', steps, failure_reason: `Max tool errors reached (${maxToolErrs})` };
        }
        ctx = this.injectToolError(ctx, toolName, result);
        continue;
      } else {
        toolErrors = 0;
      }

      // 5. Observe step
      ctx = await this.observe();
    }
  }

  private async observe(): Promise<string> {
    try {
      return await this.runner.observe();
    } catch (e: any) {
      return `[Context overflow] ${e.message}`;
    }
  }

  private async callPlanner(goal: string, ctx: string): Promise<ParseResult & { finish_reason?: string | null }> {
    this.eventBus.emit('plan_stream_start', {});
    try {
      return await this.runner.planStream(goal, ctx, (ev) => {
        this.eventBus.emit('plan_event', ev as any);
      });
    } finally {
      this.eventBus.emit('plan_stream_end', {});
    }
  }

  private async executeTool(plan: ParseResult): Promise<ToolResult> {
    const call: ToolCall = {
      tool: (plan as any).tool,
      args: (plan as any).args || {},
      summary: (plan as any).summary,
    };
    return await this.runner.runCall(call);
  }

  private extractStopContent(plan: ParseResult): string {
    if (!plan) return '';
    return String((plan as any).content ?? (plan as any).args?.content ?? '');
  }

  private injectFormatError(ctx: string): string {
    const msg = [
      '[SYSTEM ERROR] Your last response was not parsed as a valid tool call JSON.',
      '- To call a tool: output ONLY a single valid JSON object. Example:',
      '  {"tool": "bash_command", "args": {"command": "ls"}, "summary": "List files"}',
      '- To finish the task: provide your final answer as plain text. The system will detect your natural stop and complete automatically.',
      'Do NOT write text outside the JSON object when calling a tool. Try again now.',
    ].join('\n');
    return `${msg}\n\n${ctx}`;
  }

  private injectToolError(ctx: string, toolName: string, result: ToolResult): string {
    return `[TOOL ERROR] Tool '${toolName}' was ${result.status}: ${result.advice || result.error || 'No explanation provided.'}\n` +
      `Please choose a different approach or tool.\n\n${ctx}`;
  }
}


import { AgentLoop } from '../../core/kernel/agentLoop.js';
import type { ToolCall } from '../../core/kernel/interfaces.js';
import { Runner } from '../../core/kernel/runner.js';
import * as PathResolver from '../../utils/pathResolver.js';
import * as UI from '../ui.js';

interface FormattedLoopStep {
  tool: string;
  args: Record<string, unknown>;
  summary?: string | null;
  status: string | null;
  output: string;
}

export class Kernel {
  public static async observe(
    projectPath?: string,
    options: { human?: boolean; previewLines?: number } = {},
  ): Promise<void> {
    const root = Kernel.resolveProjectPath(projectPath);
    const runner = new Runner(root);
    let ctx = '';

    try {
      const observed = await runner.observe();
      ctx = typeof observed === 'string' ? observed : observed.toString();
    } catch (e: unknown) {
      ctx = `[Context overflow] ${(e as Error).message}`;
    }

    if (options.human) {
      const limit = options.previewLines ?? 50;
      const lines = ctx.split('\n');
      const output =
        lines.length > limit ? `${lines.slice(0, limit).join('\n')}\n...` : ctx;
      console.log(output);
    } else {
      console.log(JSON.stringify({ context: ctx }));
    }
  }

  public static async runCall(
    tool: string,
    argsJson: string,
    projectPath?: string,
  ): Promise<void> {
    const root = Kernel.resolveProjectPath(projectPath);
    const runner = new Runner(root);
    let args = {};

    try {
      args = JSON.parse(argsJson);
    } catch (e: unknown) {
      throw new UI.CliError(`Invalid args JSON: ${(e as Error).message}`);
    }

    const out = await runner.runCall({ tool, args });
    if (typeof out === 'string') {
      console.log(out);
    } else {
      console.log(JSON.stringify(out));
    }
  }

  public static async once(
    projectPath?: string,
    options: {
      call?: string;
      input?: string;
      ask?: boolean;
      human?: boolean;
      verbose?: boolean;
      previewLines?: number;
    } = {},
  ): Promise<void> {
    const root = Kernel.resolveProjectPath(projectPath);
    const runner = new Runner(root);
    let input = options.input || '';

    if (options.ask && (!input || input.trim().length === 0)) {
      input = await Kernel.readStdinLine('Input> ');
    }

    input = input.trim();
    if (input.length > 0) {
      runner.recordUserInput(input);
    }

    let ctx = '';
    try {
      const observed = await runner.observe();
      ctx = typeof observed === 'string' ? observed : observed.toString();
    } catch (e: unknown) {
      ctx = `[Context overflow] ${(e as Error).message}`;
    }

    let payload: ToolCall | null = null;
    if (options.call) {
      try {
        payload = JSON.parse(options.call) as ToolCall;
      } catch (e: unknown) {
        throw new UI.CliError(`Invalid call JSON: ${(e as Error).message}`);
      }
    }

    if (!payload && input.length > 0) {
      const plan = await runner.plan(input, ctx);
      if (plan && plan.type === 'tool_call') {
        payload = {
          tool: plan.tool,
          args: plan.args || {},
          summary: plan.summary,
        };
      }
    }

    const verbose = !!options.verbose || process.env.VERBOSE === 'true';
    const previewLines = options.previewLines || 5;

    if (payload) {
      const out = await runner.runCall(payload);
      if (options.human) {
        console.log(
          Kernel.humanKernelOutput(ctx, out, payload, previewLines, verbose),
        );
      } else {
        const preview = ctx.split('\n').slice(0, previewLines).join('\n');
        console.log(JSON.stringify({ context_preview: preview, result: out }));
      }
    } else {
      if (options.human) {
        console.log(
          Kernel.humanKernelOutput(ctx, null, null, previewLines, verbose),
        );
      } else {
        console.log(ctx);
      }
    }
  }

  public static async plan(
    projectPath?: string,
    options: { goal?: string; human?: boolean; previewLines?: number } = {},
  ): Promise<void> {
    const root = Kernel.resolveProjectPath(projectPath);
    const runner = new Runner(root);
    let ctx = '';

    try {
      const observed = await runner.observe();
      ctx = typeof observed === 'string' ? observed : observed.toString();
    } catch (e: unknown) {
      ctx = `[Context overflow] ${(e as Error).message}`;
    }

    const res = await runner.plan(options.goal, ctx);
    const previewLines = options.previewLines || 5;
    const preview = ctx.split('\n').slice(0, previewLines).join('\n');

    if (options.human) {
      console.log('== Context Preview ==');
      console.log(preview);
      console.log('== Plan ==');
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(JSON.stringify({ context_preview: preview, plan: res }));
    }
  }

  public static async loop(
    projectPath?: string,
    options: {
      goal?: string;
      human?: boolean;
      verbose?: boolean;
      maxSteps?: number;
    } = {},
  ): Promise<void> {
    const root = Kernel.resolveProjectPath(projectPath);
    const runner = new Runner(root);

    if (options.goal?.trim()) {
      runner.recordUserInput(options.goal.trim());
    }

    const prefix = process.env.AURA_SUBAGENT_ID
      ? `[Subagent ${process.env.AURA_SUBAGENT_ID}]`
      : '[Agent]';
    const eventBus = {
      emit: (event: string, payload?: Record<string, any>) => {
        if (event === 'thought') {
          const content = payload?.content?.trim();
          if (content) process.stderr.write(`${prefix} Thought: ${content}\n`);
        } else if (event === 'tool_start') {
          process.stderr.write(
            `${prefix} Tool Call: ${payload?.tool} | ${payload?.summary || ''}\n`,
          );
        } else if (event === 'tool_result') {
          process.stderr.write(
            `${prefix} Tool Result: ${payload?.result?.status || 'ok'}\n`,
          );
        } else if (event === 'final_answer') {
          const content = payload?.content?.trim();
          if (content)
            process.stderr.write(`${prefix} Final Answer: ${content}\n`);
        }
      },
    };

    const agentLoop = new AgentLoop(runner, { eventBus });
    const maxSteps = options.maxSteps || 30;
    const res = await agentLoop.run(options.goal || '', {
      max_steps: maxSteps,
    });

    const formattedSteps = res.steps.map((step) => {
      const payload = {
        tool: step.tool,
        args: step.args || {},
        summary: step.summary,
      };
      return Kernel.formatLoopStep(payload, step.result);
    });

    let finalRes: unknown = null;
    if (res.status === 'completed') {
      finalRes = res.steps[res.steps.length - 1]
        ? res.steps[res.steps.length - 1].result
        : { status: 'completed', content: res.final_content };
    } else {
      finalRes = {
        status: 'failed',
        reason: res.failure_reason || 'aborted',
        steps: res.steps.length,
      };
    }

    if (options.human) {
      const verbose = !!options.verbose || process.env.VERBOSE === 'true';
      formattedSteps.forEach((s) => {
        console.log(Kernel.humanLoopStep(s, verbose));
      });
    } else {
      console.log(JSON.stringify({ steps: formattedSteps, final: finalRes }));
    }
  }

  private static formatLoopStep(
    payload: {
      tool: string;
      args?: Record<string, unknown>;
      summary?: string | null;
    },
    out: unknown,
  ): FormattedLoopStep {
    const outObj =
      out && typeof out === 'object' ? (out as Record<string, unknown>) : null;
    const status = outObj ? (outObj.status as string | null) : null;
    const body = outObj
      ? outObj.content ||
        outObj.output ||
        outObj.message ||
        outObj.stdout ||
        outObj.stderr ||
        JSON.stringify(outObj)
      : String(out);
    return {
      tool: payload.tool,
      args: payload.args || {},
      summary: payload.summary,
      status,
      output: String(body),
    };
  }

  private static humanLoopStep(
    step: FormattedLoopStep,
    verbose: boolean,
  ): string {
    const lines = [];
    lines.push('== Step ==');
    lines.push(`Tool: ${step.tool}`);
    if (verbose) {
      lines.push(`Args: ${JSON.stringify(step.args || {})}`);
    }
    if (step.summary) {
      lines.push(`Summary: ${step.summary}`);
    }
    if (step.status) {
      lines.push(`Status: ${step.status}`);
    }
    lines.push('Output:');
    let body = String(step.output || '');
    if (!verbose) {
      body = Kernel.truncateOutput(body, 5);
    }
    lines.push(body);
    return lines.join('\n');
  }

  private static humanKernelOutput(
    ctx: string,
    out: unknown,
    payload: ToolCall | null,
    nlines: number,
    verbose: boolean,
  ): string {
    const lines = [];
    lines.push('== Context Preview ==');
    lines.push(ctx.split('\n').slice(0, nlines).join('\n'));
    lines.push('== Call ==');

    if (payload) {
      lines.push(`Tool: ${payload.tool}`);
      if (verbose) {
        lines.push(`Args: ${JSON.stringify(payload.args || {})}`);
      }
      if (payload.summary) {
        lines.push(`Summary: ${payload.summary}`);
      }
    } else {
      lines.push('(no call provided)');
    }

    lines.push('== Result ==');
    if (out === null || out === undefined) {
      lines.push('(no execution)');
    } else if (out && typeof out === 'object') {
      const outObj = out as Record<string, unknown>;
      const status = (outObj.status as string) || 'ok';
      if (['blocked', 'upgrade_required'].includes(status)) {
        lines.push(`Status: ${status} (Tool execution blocked/failed)`);
      } else {
        lines.push(`Status: ${status}`);
      }
      let body = Kernel.formatResultBody(out);
      if (!verbose) {
        body = Kernel.truncateOutput(body, 5);
      }
      lines.push(body);
    } else {
      lines.push(String(out));
    }

    return lines.join('\n');
  }

  private static formatResultBody(res: unknown): string {
    const resObj =
      res && typeof res === 'object' ? (res as Record<string, unknown>) : null;
    if (!resObj) return String(res);
    const candidates = [
      resObj.content,
      resObj.output,
      resObj.message,
      resObj.stdout,
      resObj.stderr,
    ];
    const found = candidates.find(
      (v) => v !== undefined && v !== null && String(v).trim().length > 0,
    );
    if (found !== undefined) return String(found);

    const keys = Object.keys(resObj);
    if (keys.length > 0) {
      return `Result returned (fields: ${keys.join(', ')})`;
    }
    return 'Result returned';
  }

  private static truncateOutput(body: string, maxLines: number): string {
    const lines = body.split('\n');
    if (lines.length <= maxLines) return body;
    return `${lines.slice(0, maxLines).join('\n')}\n...`;
  }

  private static resolveProjectPath(projectPath?: string): string {
    try {
      const resolved = PathResolver.resolveProjectPath(
        projectPath || undefined,
      );
      if (resolved) return resolved;
    } catch {}
    return process.cwd();
  }

  private static readStdinLine(promptText: string): Promise<string> {
    return new Promise((resolve) => {
      process.stdout.write(promptText);
      const onData = (data: Buffer) => {
        process.stdin.off('data', onData);
        resolve(data.toString().trim());
      };
      process.stdin.on('data', onData);
    });
  }
}

import { LLMClient } from '../llm/client.js';
import { PromptsCompose } from '../llm/prompts/compose.js';
import { ResponseParser, ParseResult } from '../llm/parsers/responseParser.js';
import { ConfigManager } from '../../utils/configManager.js';
import * as PathResolver from '../../utils/pathResolver.js';
import type { PlanEvent } from './interfaces.js';

export class Planner {
  public readonly client: LLMClient;
  public readonly temp?: number;
  public readonly maxTokens?: number;
  private projectPath: string;
  private envPath: string;

  constructor(projectPath: string, options: any = {}) {
    this.projectPath = pathResolve(projectPath);
    this.envPath = options.envPath || PathResolver.environmentPath(this.projectPath) || this.projectPath;

    const cfg = this.loadConfig();
    const llmCfg = cfg.llm || {};
    this.temp = llmCfg.temperature;
    this.maxTokens = llmCfg.max_tokens;

    this.client = LLMClient.fromConfig(llmCfg, this.projectPath);
  }

  public async plan(context: any, goal?: string | null): Promise<ParseResult & { finish_reason?: string | null }> {
    const [messages, tools] = PromptsCompose.messagesAndTools(context, goal);

    const options: Record<string, any> = {
      temperature: this.temp,
      max_tokens: this.maxTokens,
    };
    if (tools && tools.length > 0) {
      options.tools = tools;
    }

    const out = await this.client.complete(messages, options);
    const parsed = ResponseParser.parse(out.raw || out.content);

    this.validateParsedPlan(parsed, out.content);

    return {
      ...parsed,
      finish_reason: out.finish_reason || null,
    };
  }

  public async planStream(
    context: any,
    goal: string | null,
    onEvent?: (ev: PlanEvent) => void
  ): Promise<ParseResult & { finish_reason?: string | null }> {
    const [messages, tools] = PromptsCompose.messagesAndTools(context, goal);

    const options: Record<string, any> = {
      temperature: this.temp,
      max_tokens: this.maxTokens,
    };
    if (tools && tools.length > 0) {
      options.tools = tools;
    }

    let buf = '';
    let yieldedPlan = false;
    let finalParsed: any = null;

    const res = await this.client.completeStream(messages, options, (delta) => {
      if (onEvent) {
        onEvent({ type: 'delta', text: delta });
      }
      buf += delta || '';

      if (buf.includes('}') && !yieldedPlan) {
        const parsed = ResponseParser.parse(buf);
        if (parsed.type === 'tool_call') {
          yieldedPlan = true;
          finalParsed = parsed;
          if (onEvent) {
            onEvent({ type: 'plan', plan: parsed });
          }
        }
      }
    });

    if (finalParsed) {
      return {
        ...finalParsed,
        finish_reason: res.finish_reason || null,
      };
    }

    const parsed = ResponseParser.parse(res.raw || res.content || buf);
    if (onEvent) {
      onEvent({ type: 'plan', plan: parsed });
    }

    return {
      ...parsed,
      finish_reason: res.finish_reason || null,
    };
  }

  private validateParsedPlan(parsed: ParseResult, rawBody: string): void {
    if (this.silencePlannerWarnings()) {
      return;
    }

    if (parsed.type === 'tool_call') {
      if (!parsed.tool || !parsed.tool.trim()) {
        console.warn('\x1b[33m⚠️ Warning: Parsed tool call missing tool name\x1b[0m');
        console.warn(`   Raw: ${rawBody.substring(0, 200)}...`);
      }
      if (!parsed.args || typeof parsed.args !== 'object') {
        console.warn(`\x1b[33m⚠️ Warning: Tool args is not an object: ${typeof parsed.args}\x1b[0m`);
        console.warn(`   Raw: ${rawBody.substring(0, 200)}...`);
      }
    } else if (parsed.type === 'text') {
      console.warn('\x1b[33m⚠️ Warning: LLM returned text instead of JSON\x1b[0m');
      console.warn(`   Raw: ${rawBody.substring(0, 300)}...`);
    }
  }

  private silencePlannerWarnings(): boolean {
    if (process.env.AURA_SILENCE_PLANNER_WARNINGS === '1') return true;
    return process.env.NODE_ENV === 'test';
  }

  private loadConfig(): any {
    try {
      return ConfigManager.load(this.envPath) || {};
    } catch (e) {
      return {};
    }
  }
}

function pathResolve(p: string): string {
  // Safe helper
  return p.startsWith('/') || p.includes(':') ? p : p;
}

import path from 'node:path';
import * as PathResolver from '../../utils/pathResolver.js';
import { LLMClient } from '../llm/client.js';
import {
  type ParseResult,
  ResponseParser,
} from '../llm/parsers/responseParser.js';
import * as PromptsCompose from '../llm/prompts/compose.js';
import { KernelConfig } from './config.js';
import type { PlanEvent } from './interfaces.js';

export class Planner {
  public readonly client: LLMClient;
  public readonly temp?: number;
  public readonly maxTokens?: number;
  private projectPath: string;
  private envPath: string;

  constructor(projectPath: string, options: Record<string, unknown> = {}) {
    this.projectPath = pathResolve(projectPath);
    this.envPath =
      (options.envPath as string) ||
      PathResolver.environmentPath(this.projectPath) ||
      this.projectPath;

    const llmCfg = KernelConfig.fromFile(this.envPath).llm;
    this.temp = llmCfg?.temperature;
    this.maxTokens = llmCfg?.max_tokens;

    this.client = LLMClient.fromConfig(llmCfg, this.projectPath);
  }

  public async plan(
    context: PromptsCompose.ContextPayload | string,
    goal?: string | null,
  ): Promise<ParseResult & { finish_reason?: string | null }> {
    const [messages, tools] = PromptsCompose.messagesAndTools(context, goal);

    const options: Record<string, unknown> = {
      temperature: this.temp,
      max_tokens: this.maxTokens,
    };
    if (tools && tools.length > 0) {
      options.tools = tools;
    }

    const out = await this.client.complete(messages, options);
    const parsed = ResponseParser.parse(out.raw || out.content);
    this.resolveToolName(context, parsed);

    this.validateParsedPlan(parsed, out.content);

    const result: ParseResult & { finish_reason?: string | null } = {
      ...(parsed as object),
      finish_reason: out.finish_reason || null,
    } as ParseResult & { finish_reason?: string | null };
    return result;
  }

  public async planStream(
    context: PromptsCompose.ContextPayload | string,
    goal: string | null,
    onEvent?: (ev: PlanEvent) => void,
  ): Promise<ParseResult & { finish_reason?: string | null }> {
    const [messages, tools] = PromptsCompose.messagesAndTools(context, goal);

    const options: Record<string, unknown> = {
      temperature: this.temp,
      max_tokens: this.maxTokens,
    };
    if (tools && tools.length > 0) {
      options.tools = tools;
    }

    let buf = '';

    const res = await this.client.completeStream(messages, options, (delta) => {
      if (onEvent) {
        onEvent({ type: 'delta', text: delta });
      }
      buf += delta || '';
    });

    const parsed = ResponseParser.parse(res.raw || res.content || buf);
    this.resolveToolName(context, parsed);
    if (onEvent) {
      onEvent({ type: 'plan', plan: parsed });
    }

    const result: ParseResult & { finish_reason?: string | null } = {
      ...(parsed as object),
      finish_reason: res.finish_reason || null,
    } as ParseResult & { finish_reason?: string | null };
    return result;
  }

  /**
   * Tool names sent to the model may have been sanitized to satisfy native
   * tool-calling name restrictions (see ContextPayload.toToolSchemas). Map
   * the model's response back to the original (possibly dotted) tool name
   * before dispatch sees it.
   */
  private resolveToolName(
    context: PromptsCompose.ContextPayload | string,
    parsed: ParseResult,
  ): void {
    if (parsed.type !== 'tool_call') return;
    if (typeof context !== 'object' || !context) return;
    if (typeof context.resolveToolName !== 'function') return;
    parsed.tool = context.resolveToolName(parsed.tool);
  }

  private validateParsedPlan(parsed: ParseResult, rawBody: string): void {
    if (this.silencePlannerWarnings()) {
      return;
    }

    if (parsed.type === 'tool_call') {
      if (!parsed.tool?.trim()) {
        console.warn(
          '\x1b[33m⚠️ Warning: Parsed tool call missing tool name\x1b[0m',
        );
        console.warn(`   Raw: ${rawBody.substring(0, 200)}...`);
      }
      if (!parsed.args || typeof parsed.args !== 'object') {
        console.warn(
          `\x1b[33m⚠️ Warning: Tool args is not an object: ${typeof parsed.args}\x1b[0m`,
        );
        console.warn(`   Raw: ${rawBody.substring(0, 200)}...`);
      }
    } else if (parsed.type === 'text') {
      console.warn(
        '\x1b[33m⚠️ Warning: LLM returned text instead of JSON\x1b[0m',
      );
      console.warn(`   Raw: ${rawBody.substring(0, 300)}...`);
    }
  }

  private silencePlannerWarnings(): boolean {
    if (process.env.AURA_SILENCE_PLANNER_WARNINGS === '1') return true;
    return process.env.NODE_ENV === 'test';
  }
}

function pathResolve(p: string): string {
  return path.resolve(p);
}

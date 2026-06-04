export interface ToolCallResult {
  type: 'tool_call';
  tool: string;
  args: Record<string, any>;
  summary?: string | null;
  thought?: string | null;
  finish_reason?: string | null;
}

export interface TextResult {
  type: 'text';
  content: string;
  thought: string;
  finish_reason?: string | null;
}

export type ParseResult = ToolCallResult | TextResult;

export class ResponseParser {
  public static parse(output: any): ParseResult {
    const raw = typeof output === 'string' ? output : String(output || '');
    const obj = typeof output === 'string' ? (this.safeJsonParse(raw) || raw) : output;

    if (obj && typeof obj === 'object') {
      const toolVal = obj.tool;
      if (toolVal) {
        const argsVal = obj.args;
        const summaryVal = obj.summary;
        let thoughtVal = obj.thought ?? obj.content ?? obj.message ?? null;
        if (thoughtVal && typeof thoughtVal === 'object' && thoughtVal.content) {
          thoughtVal = thoughtVal.content;
        }
        return {
          type: 'tool_call',
          tool: String(toolVal),
          args: this.normalizeArgs(argsVal),
          summary: summaryVal ? String(summaryVal) : null,
          thought: thoughtVal ? String(thoughtVal) : null,
        };
      }

      const tc = obj.tool_calls;
      if (Array.isArray(tc) && tc.length > 0) {
        const call = tc[0] || {};
        const tool = call.tool ?? call.name ?? call.function?.name;
        let args = call.args ?? call.arguments ?? call.input ?? call.function?.arguments ?? {};
        args = this.normalizeArgs(args);
        const summary = obj.summary ?? call.summary ?? (typeof args === 'object' ? args.summary : null);
        if (args && typeof args === 'object') {
          delete args.summary;
        }
        const thought = obj.content ?? obj.message?.content ?? null;
        return {
          type: 'tool_call',
          tool: String(tool || ''),
          args: args || {},
          summary: summary ? String(summary) : null,
          thought: thought ? String(thought) : null,
        };
      }

      // Check choices[0].message.tool_calls
      const choices = obj.choices;
      if (Array.isArray(choices) && choices.length > 0) {
        const nested = choices[0]?.message?.tool_calls;
        if (Array.isArray(nested) && nested.length > 0) {
          const call = nested[0] || {};
          const tool = call.tool ?? call.name ?? call.function?.name;
          let args = call.args ?? call.arguments ?? call.input ?? call.function?.arguments ?? {};
          args = this.normalizeArgs(args);
          const summary = obj.summary ?? call.summary ?? (typeof args === 'object' ? args.summary : null);
          if (args && typeof args === 'object') {
            delete args.summary;
          }
          const thought = choices[0]?.message?.content ?? null;
          return {
            type: 'tool_call',
            tool: String(tool || ''),
            args: args || {},
            summary: summary ? String(summary) : null,
            thought: thought ? String(thought) : null,
          };
        }
      }

      const contentVal = obj.content;
      const thoughtVal = obj.thought ?? contentVal;
      if (contentVal !== undefined || thoughtVal !== undefined) {
        return {
          type: 'text',
          content: contentVal !== undefined ? String(contentVal) : '',
          thought: thoughtVal !== undefined ? String(thoughtVal) : '',
        };
      }
    }

    return {
      type: 'text',
      content: raw,
      thought: raw,
    };
  }

  public static safeJsonParse(s: string): any {
    try {
      return JSON.parse(s);
    } catch (e) {
      const blk = this.extractJsonBlock(s);
      if (blk) {
        try {
          return JSON.parse(blk);
        } catch (err) {}
      }
      return null;
    }
  }

  public static extractJsonBlock(s: string): string | null {
    if (s.includes('```')) {
      // Remove ```json and ```
      const a = s.replace(/^\s*```json\s*/gm, '').replace(/^\s*```\s*/gm, '');
      const b = a.split('```')[0].trim();
      if (b.startsWith('{')) {
        return b;
      }
    }
    const start = s.indexOf('{');
    const endi = s.lastIndexOf('}');
    if (start !== -1 && endi !== -1 && endi > start) {
      return s.substring(start, endi + 1);
    }
    return null;
  }

  public static normalizeArgs(args: any): Record<string, any> {
    if (args === null || args === undefined) {
      return {};
    }
    if (typeof args === 'string') {
      try {
        const parsed = JSON.parse(args);
        return parsed && typeof parsed === 'object' ? parsed : { value: parsed };
      } catch (e) {
        return { value: args };
      }
    }
    if (typeof args === 'object') {
      const out = { ...args };
      delete out.summary;
      return out;
    }
    return { value: args };
  }
}

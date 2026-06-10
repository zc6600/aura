export interface ToolCallResult {
  type: 'tool_call';
  tool: string;
  args: Record<string, unknown>;
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
  public static parse(output: unknown): ParseResult {
    const raw = typeof output === 'string' ? output : String(output || '');
    const obj =
      typeof output === 'string'
        ? ResponseParser.safeJsonParse(raw) || raw
        : output;

    if (obj && typeof obj === 'object') {
      const toolVal = (obj as Record<string, unknown>).tool;
      if (toolVal) {
        const argsVal = (obj as Record<string, unknown>).args;
        const summaryVal = (obj as Record<string, unknown>).summary;
        let thoughtVal: unknown =
          (obj as Record<string, unknown>).thought ??
          (obj as Record<string, unknown>).content ??
          (obj as Record<string, unknown>).message ??
          null;
        if (
          thoughtVal &&
          typeof thoughtVal === 'object' &&
          (thoughtVal as Record<string, unknown>).content
        ) {
          thoughtVal = (thoughtVal as Record<string, unknown>).content;
        }
        return {
          type: 'tool_call',
          tool: String(toolVal),
          args: ResponseParser.normalizeArgs(argsVal),
          summary: summaryVal ? String(summaryVal) : null,
          thought: thoughtVal ? String(thoughtVal) : null,
        };
      }

      const tc = (obj as Record<string, unknown>).tool_calls;
      if (Array.isArray(tc) && tc.length > 0) {
        const call = (tc[0] || {}) as Record<string, unknown>;
        const tool =
          call.tool ??
          call.name ??
          (call.function as Record<string, unknown>)?.name;
        let args =
          call.args ??
          call.arguments ??
          call.input ??
          (call.function as Record<string, unknown>)?.arguments ??
          {};
        args = ResponseParser.normalizeArgs(args);
        const summary =
          (obj as Record<string, unknown>).summary ??
          call.summary ??
          (typeof args === 'object'
            ? (args as Record<string, unknown>).summary
            : null);
        if (args && typeof args === 'object') {
          delete (args as Record<string, unknown>).summary;
        }
        const thought =
          (obj as Record<string, unknown>).content ??
          ((obj as Record<string, unknown>).message as Record<string, unknown>)
            ?.content ??
          null;
        return {
          type: 'tool_call',
          tool: String(tool || ''),
          args: (args as Record<string, unknown>) || {},
          summary: summary ? String(summary) : null,
          thought: thought ? String(thought) : null,
        };
      }

      // Check choices[0].message.tool_calls
      const choices = (obj as Record<string, unknown>).choices;
      if (Array.isArray(choices) && choices.length > 0) {
        const nested = (
          (choices[0] as Record<string, unknown>)?.message as Record<
            string,
            unknown
          >
        )?.tool_calls;
        if (Array.isArray(nested) && nested.length > 0) {
          const call = (nested[0] || {}) as Record<string, unknown>;
          const tool =
            call.tool ??
            call.name ??
            (call.function as Record<string, unknown>)?.name;
          let args =
            call.args ??
            call.arguments ??
            call.input ??
            (call.function as Record<string, unknown>)?.arguments ??
            {};
          args = ResponseParser.normalizeArgs(args);
          const summary =
            (obj as Record<string, unknown>).summary ??
            call.summary ??
            (typeof args === 'object'
              ? (args as Record<string, unknown>).summary
              : null);
          if (args && typeof args === 'object') {
            delete (args as Record<string, unknown>).summary;
          }
          const thought =
            (
              (choices[0] as Record<string, unknown>)?.message as Record<
                string,
                unknown
              >
            )?.content ?? null;
          return {
            type: 'tool_call',
            tool: String(tool || ''),
            args: (args as Record<string, unknown>) || {},
            summary: summary ? String(summary) : null,
            thought: thought ? String(thought) : null,
          };
        }
      }

      const contentVal = (obj as Record<string, unknown>).content;
      const thoughtVal = (obj as Record<string, unknown>).thought ?? contentVal;
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

  public static safeJsonParse(s: string): unknown {
    try {
      return JSON.parse(s);
    } catch (_e) {
      const blk = ResponseParser.extractJsonBlock(s);
      if (blk) {
        try {
          return JSON.parse(blk);
        } catch (_err) {}
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

  public static normalizeArgs(args: unknown): Record<string, unknown> {
    if (args === null || args === undefined) {
      return {};
    }
    if (typeof args === 'string') {
      try {
        const parsed = JSON.parse(args);
        return parsed && typeof parsed === 'object'
          ? (parsed as Record<string, unknown>)
          : { value: parsed };
      } catch (_e) {
        return { value: args };
      }
    }
    if (typeof args === 'object') {
      const out = { ...(args as Record<string, unknown>) };
      delete out.summary;
      return out;
    }
    return { value: args };
  }
}

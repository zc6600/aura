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
    if (output === null || output === undefined) {
      return { type: 'text', content: '', thought: '' };
    }

    // 1. If output is string
    if (typeof output === 'string') {
      const trimmed = output.trim();
      const obj = ResponseParser.safeJsonParse(trimmed);
      if (obj && typeof obj === 'object') {
        const parsed = ResponseParser.parseObject(obj);
        if (!parsed.thought && parsed.type === 'tool_call') {
          const preText = ResponseParser.extractPreJsonText(trimmed);
          if (preText) parsed.thought = preText;
        }
        return parsed;
      }
      return { type: 'text', content: output, thought: output };
    }

    // 2. If output is an object
    if (typeof output === 'object') {
      // Try parsing object directly (tool, tool_calls, choices[0].message.tool_calls)
      const parsedObj = ResponseParser.parseObject(output);
      if (parsedObj.type === 'tool_call') {
        return parsedObj;
      }

      // Check if this is an API response / adapter wrapper containing text content
      const record = output as Record<string, unknown>;
      let textContent: string | null = null;

      if (typeof record.content === 'string' && record.content.trim()) {
        textContent = record.content;
      } else if (Array.isArray(record.choices) && record.choices.length > 0) {
        const msg = (record.choices[0] as Record<string, unknown>)?.message as
          | Record<string, unknown>
          | undefined;
        if (typeof msg?.content === 'string' && msg.content.trim()) {
          textContent = msg.content;
        }
      }

      if (textContent) {
        const subParse = ResponseParser.parse(textContent);
        if (subParse.type === 'tool_call') {
          return subParse;
        }
        return {
          type: 'text',
          content: textContent,
          thought: record.thought ? String(record.thought) : textContent,
        };
      }

      const contentVal =
        record.content !== undefined ? String(record.content) : String(output);
      const thoughtVal =
        record.thought !== undefined ? String(record.thought) : contentVal;
      return {
        type: 'text',
        content: contentVal,
        thought: thoughtVal,
      };
    }

    const str = String(output);
    return { type: 'text', content: str, thought: str };
  }

  public static parseObject(obj: unknown): ParseResult {
    if (!obj || typeof obj !== 'object') {
      return {
        type: 'text',
        content: String(obj || ''),
        thought: String(obj || ''),
      };
    }

    const record = obj as Record<string, unknown>;

    // Case A: { tool: "name", args: {...} }
    const toolVal = record.tool;
    if (toolVal) {
      const argsVal = record.args;
      const summaryVal = record.summary;
      let thoughtVal: unknown =
        record.thought ?? record.content ?? record.message ?? null;
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

    // Case B: { tool_calls: [...] }
    const tc = record.tool_calls;
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
        record.summary ??
        call.summary ??
        (typeof args === 'object'
          ? (args as Record<string, unknown>).summary
          : null);
      if (args && typeof args === 'object') {
        delete (args as Record<string, unknown>).summary;
      }
      const thought =
        record.content ??
        (record.message as Record<string, unknown>)?.content ??
        null;
      return {
        type: 'tool_call',
        tool: String(tool || ''),
        args: (args as Record<string, unknown>) || {},
        summary: summary ? String(summary) : null,
        thought: thought ? String(thought) : null,
      };
    }

    // Case C: { choices: [{ message: { tool_calls: [...] } }] }
    const choices = record.choices;
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
          record.summary ??
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

    const contentVal = record.content;
    const thoughtVal = record.thought ?? contentVal;
    if (contentVal !== undefined || thoughtVal !== undefined) {
      return {
        type: 'text',
        content: contentVal !== undefined ? String(contentVal) : '',
        thought: thoughtVal !== undefined ? String(thoughtVal) : '',
      };
    }

    const serialized =
      typeof obj === 'object' && obj !== null
        ? JSON.stringify(obj)
        : String(obj);
    return {
      type: 'text',
      content: serialized,
      thought: serialized,
    };
  }

  public static extractPreJsonText(s: string): string | null {
    const jsonBlockIndex = s.indexOf('```');
    if (jsonBlockIndex > 0) {
      const preText = s.substring(0, jsonBlockIndex).trim();
      if (preText) return preText;
    }
    const braceIndex = s.indexOf('{');
    if (braceIndex > 0) {
      const preText = s.substring(0, braceIndex).trim();
      if (preText) return preText;
    }
    return null;
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
    const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/i;
    const jsonMatch = jsonBlockRegex.exec(s);
    if (jsonMatch?.[1]) {
      const candidate = jsonMatch[1].trim();
      if (candidate.startsWith('{')) {
        return candidate;
      }
    }

    const genericBlockRegex = /```\s*([\s\S]*?)\s*```/g;
    genericBlockRegex.lastIndex = 0;
    while (true) {
      const match = genericBlockRegex.exec(s);
      if (match === null) {
        break;
      }
      const candidate = match[1].trim();
      if (candidate.startsWith('{')) {
        return candidate;
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

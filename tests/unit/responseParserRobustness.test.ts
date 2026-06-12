import { describe, expect, it } from 'vitest';
import { ResponseParser } from '../../src/core/llm/parsers/responseParser.js';

describe('ResponseParser Robustness', () => {
  it('should extract JSON from markdown code blocks even if surrounding text has braces', () => {
    const s =
      'Notes: {some bracket text}. \n\n```json\n{\n  "tool": "delta",\n  "args": {"val": true}\n}\n```\nAnd some trailing {braces} here.';
    const res = ResponseParser.parse(s);
    expect(res.type).toBe('tool_call');
    if (res.type === 'tool_call') {
      expect(res.tool).toBe('delta');
      expect(res.args).toEqual({ val: true });
    }
  });

  it('should extract JSON from generic markdown code blocks even if surrounding text has braces', () => {
    const s =
      'Pre-brackets {abc: 123}.\n```\n{\n  "tool": "echo",\n  "args": {"text": "hello"}\n}\n```\nPost-brackets {xyz: 999}';
    const res = ResponseParser.parse(s);
    expect(res.type).toBe('tool_call');
    if (res.type === 'tool_call') {
      expect(res.tool).toBe('echo');
      expect(res.args).toEqual({ text: 'hello' });
    }
  });

  it('should fallback to first brace to last brace if no markdown block is found', () => {
    const s =
      'Plain text before {\n  "tool": "test",\n  "args": {}\n} Plain text after';
    const res = ResponseParser.parse(s);
    expect(res.type).toBe('tool_call');
    if (res.type === 'tool_call') {
      expect(res.tool).toBe('test');
    }
  });
});

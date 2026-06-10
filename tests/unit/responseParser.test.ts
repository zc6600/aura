import { describe, expect, it } from 'vitest';
import { ResponseParser } from '../../src/core/llm/parsers/responseParser.js';

describe('ResponseParser', () => {
  it('should parse standard JSON tool calls with summary and thought', () => {
    const body = JSON.stringify({
      tool: 'alpha',
      args: { param1: 'val1' },
      summary: '简述：调用alpha',
      thought: 'Let us run alpha',
    });

    const res = ResponseParser.parse(body);
    expect(res.type).toBe('tool_call');
    if (res.type === 'tool_call') {
      expect(res.tool).toBe('alpha');
      expect(res.args).toEqual({ param1: 'val1' });
      expect(res.summary).toBe('简述：调用alpha');
      expect(res.thought).toBe('Let us run alpha');
    }
  });

  it('should parse tool_calls array structure (OpenAI style)', () => {
    const body = {
      tool_calls: [
        {
          function: {
            name: 'beta',
            arguments: JSON.stringify({ x: 10 }),
          },
        },
      ],
      summary: 'Run beta',
    };

    const res = ResponseParser.parse(body);
    expect(res.type).toBe('tool_call');
    if (res.type === 'tool_call') {
      expect(res.tool).toBe('beta');
      expect(res.args).toEqual({ x: 10 });
      expect(res.summary).toBe('Run beta');
    }
  });

  it('should parse nested choices tool_calls structure', () => {
    const body = {
      choices: [
        {
          message: {
            content: 'Thinking...',
            tool_calls: [
              {
                function: {
                  name: 'gamma',
                  arguments: { y: 'hello' },
                },
              },
            ],
          },
        },
      ],
    };

    const res = ResponseParser.parse(body);
    expect(res.type).toBe('tool_call');
    if (res.type === 'tool_call') {
      expect(res.tool).toBe('gamma');
      expect(res.args).toEqual({ y: 'hello' });
      expect(res.thought).toBe('Thinking...');
    }
  });

  it('should parse raw text output', () => {
    const res = ResponseParser.parse('Just some plain text');
    expect(res.type).toBe('text');
    if (res.type === 'text') {
      expect(res.content).toBe('Just some plain text');
      expect(res.thought).toBe('Just some plain text');
    }
  });

  it('should extract JSON block from markdown code blocks', () => {
    const markdown =
      'Here is the JSON:\n```json\n{\n  "tool": "delta",\n  "args": {"val": true}\n}\n```\nAnd some trailing text.';
    const res = ResponseParser.parse(markdown);
    expect(res.type).toBe('tool_call');
    if (res.type === 'tool_call') {
      expect(res.tool).toBe('delta');
      expect(res.args).toEqual({ val: true });
    }
  });

  it('should normalize different argument shapes', () => {
    expect(ResponseParser.normalizeArgs(null)).toEqual({});
    expect(ResponseParser.normalizeArgs('string_arg')).toEqual({
      value: 'string_arg',
    });
    expect(ResponseParser.normalizeArgs('{"foo": "bar"}')).toEqual({
      foo: 'bar',
    });
    expect(ResponseParser.normalizeArgs({ a: 1, summary: 'ignore' })).toEqual({
      a: 1,
    });
  });
});

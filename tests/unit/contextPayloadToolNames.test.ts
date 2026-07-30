import { describe, expect, it } from 'vitest';
import { ContextPayload } from '../../src/core/context/payload.js';
import type { StructuredTool } from '../../src/core/context/providers/toolProvider.js';

function makeTool(overrides: Partial<StructuredTool>): StructuredTool {
  return {
    name: 'tool',
    description: '',
    input_schema: { type: 'object', properties: {} },
    permissions: {},
    hint: '',
    ...overrides,
  };
}

describe('ContextPayload tool name sanitization', () => {
  it('sanitizes dotted tool names for native tool schemas and leaves clean names alone', () => {
    const payload = new ContextPayload({}, [
      makeTool({ name: 'aura.registry.record' }),
      makeTool({ name: 'mcp.github.search_issues' }),
      makeTool({ name: 'groupchat' }),
    ]);

    const schemas = payload.toToolSchemas();

    expect(schemas.map((s) => s.name)).toEqual([
      'aura_registry_record',
      'mcp_github_search_issues',
      'groupchat',
    ]);
    // Names must satisfy both OpenAI's and Anthropic's `^[a-zA-Z0-9_-]{1,64}$`.
    for (const s of schemas) {
      expect(s.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    }
  });

  it('resolveToolName translates a sanitized name back to the original', () => {
    const payload = new ContextPayload({}, [
      makeTool({ name: 'aura.registry.record' }),
      makeTool({ name: 'groupchat' }),
    ]);

    payload.toToolSchemas();

    expect(payload.resolveToolName('aura_registry_record')).toBe(
      'aura.registry.record',
    );
    // Clean names were never remapped and pass through untouched.
    expect(payload.resolveToolName('groupchat')).toBe('groupchat');
    // Unknown names pass through untouched too.
    expect(payload.resolveToolName('made_up')).toBe('made_up');
  });
});

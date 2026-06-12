import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { deepMerge, readLastLinesSync } from '../../src/utils/fsUtils.js';

describe('readLastLinesSync', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-fsutils-test-'));

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('should return empty string for non-existent file', () => {
    const res = readLastLinesSync(path.join(tempDir, 'missing.txt'), 5);
    expect(res).toBe('');
  });

  it('should return empty string for empty file', () => {
    const filePath = path.join(tempDir, 'empty.txt');
    fs.writeFileSync(filePath, '');
    const res = readLastLinesSync(filePath, 5);
    expect(res).toBe('');
  });

  it('should read all lines if file has fewer lines than requested', () => {
    const filePath = path.join(tempDir, 'small.txt');
    const content = 'line1\nline2\nline3';
    fs.writeFileSync(filePath, content);
    const res = readLastLinesSync(filePath, 5);
    expect(res).toBe(content);
  });

  it('should read last N lines exactly', () => {
    const filePath = path.join(tempDir, 'lines.txt');
    const content = 'line1\nline2\nline3\nline4\nline5';
    fs.writeFileSync(filePath, content);
    const res = readLastLinesSync(filePath, 3);
    expect(res).toBe('line3\nline4\nline5');
  });

  it('should handle small chunk sizes and stitch split lines correctly', () => {
    const filePath = path.join(tempDir, 'chunks.txt');
    const content = 'line1\nline2\nline3\nline4\nline5';
    fs.writeFileSync(filePath, content);
    // Force a chunk size of 5 bytes so it reads multiple chunks
    const res = readLastLinesSync(filePath, 3, 5);
    expect(res).toBe('line3\nline4\nline5');
  });

  it('should handle trailing newline correctly', () => {
    const filePath = path.join(tempDir, 'trailing.txt');
    const content = 'line1\nline2\nline3\n';
    fs.writeFileSync(filePath, content);

    // In original code, content.split('\n') ends with an empty line.
    // If requesting last 2 lines of 'line1\nline2\nline3\n', we get 'line3\n'.
    // Let's verify the output is identical to reading entire file and doing split/slice.
    const expected = content.split('\n').slice(-2).join('\n');
    const res = readLastLinesSync(filePath, 2);
    expect(res).toBe(expected);
  });

  it('should handle files with very long lines spanning multiple chunks', () => {
    const filePath = path.join(tempDir, 'long-lines.txt');
    const longLine = 'a'.repeat(100);
    const content = `first\n${longLine}\nlast`;
    fs.writeFileSync(filePath, content);

    // chunk size 10 bytes, long line 100 bytes
    const res = readLastLinesSync(filePath, 2, 10);
    expect(res).toBe(`${longLine}\nlast`);
  });

  it('should not corrupt multi-byte UTF-8 characters at chunk boundaries', () => {
    const filePath = path.join(tempDir, 'utf8-boundary.txt');
    const content = 'line1\n你好世界\nline3';
    fs.writeFileSync(filePath, content);

    const res = readLastLinesSync(filePath, 2, 5);
    expect(res).toBe('你好世界\nline3');
  });
});

describe('deepMerge', () => {
  it('should recursively deep merge config objects', () => {
    const target = {
      system: {
        name: 'aura',
        workspace_root: '/ws',
      },
      llm: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        fallbacks: [
          { provider: 'anthropic', model: 'claude-3-haiku' }
        ],
      },
    };

    const source = {
      llm: {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
      },
      security: {
        strict_path_isolation: true,
      },
    };

    const merged = deepMerge(target, source);

    expect(merged).toEqual({
      system: {
        name: 'aura',
        workspace_root: '/ws',
      },
      llm: {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        fallbacks: [
          { provider: 'anthropic', model: 'claude-3-haiku' }
        ],
      },
      security: {
        strict_path_isolation: true,
      },
    });
  });

  it('should let array values in source completely override array values in target', () => {
    const target = {
      llm: {
        fallbacks: [
          { provider: 'openai', model: 'gpt-4' }
        ]
      }
    };
    const source = {
      llm: {
        fallbacks: [
          { provider: 'gemini', model: 'gemini-2.5-flash' }
        ]
      }
    };
    const merged = deepMerge(target, source);
    expect(merged.llm.fallbacks).toEqual([
      { provider: 'gemini', model: 'gemini-2.5-flash' }
    ]);
  });

  it('should handle primitives and null values correctly', () => {
    expect(deepMerge(null, { a: 1 })).toEqual({ a: 1 });
    expect(deepMerge({ a: 1 }, null)).toEqual({ a: 1 });
    expect(deepMerge({ a: 1 }, undefined)).toEqual({ a: 1 });
    expect(deepMerge(undefined, { a: 1 })).toEqual({ a: 1 });
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });
});

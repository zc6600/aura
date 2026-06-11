import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Registry from '../../src/core/llm/prompts/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Prompt Registry', () => {
  const tempDir = path.resolve(__dirname, 'temp-prompt-registry-test');

  beforeEach(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    fs.mkdirSync(path.join(tempDir, '.aura-workspace'), { recursive: true });
    Registry.clearCache();
  });

  afterEach(() => {
    Registry.clearCache();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('test_cached_file_reading_and_invalidation', () => {
    const filePath = path.join(tempDir, 'test.md');

    fs.writeFileSync(filePath, 'Initial Content');
    const content1 = Registry.readFileCached(filePath);
    expect(content1).toBe('Initial Content\n');

    // Update content and change mtime to trigger cache invalidation
    fs.writeFileSync(filePath, 'Updated Content');
    const stats = fs.statSync(filePath);
    const newTime = new Date(stats.mtime.getTime() + 10000);
    fs.utimesSync(filePath, newTime, newTime);

    const content2 = Registry.readFileCached(filePath);
    expect(content2).toBe('Updated Content\n');
  });

  it('test_stripping_frontmatter', () => {
    const filePath = path.join(tempDir, 'frontmatter.md');
    fs.writeFileSync(filePath, '---\nname: test\n---\nActual Body');
    const content = Registry.readFileCached(filePath);
    expect(content).toBe('Actual Body\n');
  });

  it('test_composition_priority_legacy_file', () => {
    const skillsDir = path.join(tempDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    const legacyFile = path.join(skillsDir, 'system.md');
    fs.writeFileSync(
      legacyFile,
      '# AURA OS OPERATING PROTOCOL\nLegacy Override',
    );

    const resolved = Registry.resolve('standard', tempDir);
    expect(resolved).toContain('Legacy Override');
  });

  it('test_resolve_standard_returns_default_when_no_file', () => {
    const resolved = Registry.resolve('standard', tempDir);
    expect(resolved).not.toBe('');
    expect(resolved).toContain('Aura OS');
  });

  it('test_prompt_validation', () => {
    const validPrompt = 'Output JSON with tool and args. {{project_path}}';
    expect(Registry.validatePrompt(validPrompt)).toEqual([]);

    const noJson = 'Output response with tool and args.';
    const issuesJson = Registry.validatePrompt(noJson);
    expect(issuesJson.join(' ')).toContain('JSON');

    const noTool = 'Output JSON response. {{project_path}}';
    const issuesTool = Registry.validatePrompt(noTool);
    expect(issuesTool.join(' ')).toContain('tool');

    const badPlaceholder =
      'Output JSON tool and args. {{unsupported_placeholder}}';
    const issuesPlaceholder = Registry.validatePrompt(badPlaceholder);
    expect(issuesPlaceholder.join(' ')).toContain(
      'Contains unresolved template placeholders',
    );
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillProvider } from '../../src/core/context/providers/skillProvider.js';

// Mock ToolRegistry class
vi.mock('../../src/core/kernel/registry.js', () => {
  return {
    ToolRegistry: class {
      allTools() {
        return ['available-tool-1', 'available-tool-2'];
      }
    },
  };
});

describe('SkillProvider', () => {
  let tempDir: string;
  let projectPath: string;
  let envPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'aura-test-skill-provider-'),
    );
    projectPath = path.join(tempDir, 'project');
    envPath = path.join(tempDir, 'env');
    fs.mkdirSync(projectPath, { recursive: true });
    fs.mkdirSync(envPath, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_e) {}
  });

  it('should return null when no skills exist', () => {
    const provider = new SkillProvider(projectPath, { envPath });
    expect(provider.provide()).toBeNull();
  });

  it('should read skills.md files directly', () => {
    const provider = new SkillProvider(projectPath, { envPath });
    const skillsDir = path.join(projectPath, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'skills.md'),
      'General skills text content',
      'utf-8',
    );

    expect(provider.provide()).toBe('General skills text content');
  });

  it('should scan subfolders for SKILL.md and identify missing requirements', () => {
    const provider = new SkillProvider(projectPath, { envPath });
    const skillsDir = path.join(projectPath, 'skills');
    const skillSubdir = path.join(skillsDir, 'my-skill');
    fs.mkdirSync(skillSubdir, { recursive: true });

    const skillFile = path.join(skillSubdir, 'SKILL.md');
    // available tools are ['available-tool-1', 'available-tool-2']
    // mock-tool is missing
    const content = `A---
name: Mock Skill
description: A mock skill that requires tools
requires:
  - available-tool-1
  - mock-tool
---
Skill body content
`;
    fs.writeFileSync(skillFile, content, 'utf-8');

    // Create subfolders: scripts, references, assets
    const scriptsDir = path.join(skillSubdir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, 's1.sh'), '', 'utf-8');

    const result = provider.provide();
    expect(result).toContain('### Skill: Mock Skill');
    expect(result).toContain('Description: A mock skill that requires tools');
    expect(result).toContain('Requires: available-tool-1, mock-tool');
    expect(result).toContain('Missing Requires: mock-tool');
    expect(result).not.toContain('Missing Requires: available-tool-1');
    expect(result).toContain('Scripts: s1.sh');
  });
});

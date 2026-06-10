import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GardenProvider } from '../../src/core/context/providers/gardenProvider.js';

describe('GardenProvider', () => {
  let tempDir: string;
  let projectPath: string;
  let envPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'aura-test-garden-provider-'),
    );
    projectPath = path.join(tempDir, 'project');
    envPath = path.join(tempDir, 'env');
    fs.mkdirSync(projectPath, { recursive: true });
    fs.mkdirSync(envPath, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_e) {}
  });

  it('should return null when no garden files exist', () => {
    const provider = new GardenProvider(projectPath, { envPath });
    expect(provider.provide()).toBeNull();
  });

  it('should read garden.md files without frontmatter', () => {
    const provider = new GardenProvider(projectPath, { envPath });
    const gardenMd = path.join(projectPath, 'garden.md');
    fs.writeFileSync(gardenMd, 'Simple garden text content', 'utf-8');

    expect(provider.provide()).toBe('Simple garden text content');
  });

  it('should parse frontmatter and dependencies in garden.md', () => {
    const provider = new GardenProvider(projectPath, { envPath });
    const gardensPath = path.join(envPath, 'gardens');
    fs.mkdirSync(gardensPath, { recursive: true });

    const gardenMd = path.join(gardensPath, 'garden.md');
    const content = `A---
name: mock-garden
description: A mock garden description
requires:
  - dep1
---
Some body text.

## Requirements
- \`dep2\`
- dep3
Z`;
    fs.writeFileSync(gardenMd, content, 'utf-8');

    const result = provider.provide();
    expect(result).toContain('### Garden: mock-garden');
    expect(result).toContain('Description: A mock garden description');
    expect(result).toContain('Requires: dep1, dep2, dep3');
    expect(result).toContain('Some body text.');
  });

  it('should scan subfolders for individual GARDEN.md files and report subfolders', () => {
    const provider = new GardenProvider(projectPath, { envPath });

    // Create gardens directory in project path
    const gardensDir = path.join(projectPath, 'gardens');
    const subDir = path.join(gardensDir, 'my-sub-garden');
    fs.mkdirSync(subDir, { recursive: true });

    const gardenFile = path.join(subDir, 'GARDEN.md');
    const content = `A---
name: my-sub
description: Sub garden example
requires:
  - subdep
---
Sub garden body
`;
    fs.writeFileSync(gardenFile, content, 'utf-8');

    // Create subfolders inside garden: scripts, references, datasets, tests
    const scriptsDir = path.join(subDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, 'run.sh'), '', 'utf-8');

    const result = provider.provide();
    expect(result).toContain('### Garden Examples: my-sub');
    expect(result).toContain('Description: Sub garden example');
    expect(result).toContain('Requires: subdep');
    expect(result).toContain('Scripts: run.sh');
  });
});

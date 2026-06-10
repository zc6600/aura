import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ToolRegistry } from '../../src/core/kernel/registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ToolManifest {
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
}

interface GroupManifest {
  group_name: string;
  subtools: string[];
  entry_tool?: string;
}

describe('ToolRegistry', () => {
  const tempDir = path.resolve(__dirname, 'temp-registry-test');
  const toolsPath = path.join(tempDir, 'tools');

  beforeAll(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // Clear out the temp directory before each test
    if (fs.existsSync(toolsPath)) {
      fs.rmSync(toolsPath, { recursive: true, force: true });
    }
    fs.mkdirSync(toolsPath, { recursive: true });
  });

  const createTool = (name: string, manifest: ToolManifest) => {
    const toolDir = path.join(toolsPath, name);
    fs.mkdirSync(toolDir, { recursive: true });
    fs.writeFileSync(
      path.join(toolDir, 'manifest.json'),
      JSON.stringify(manifest),
    );
  };

  const createToolGroup = (
    dirName: string,
    groupName: string,
    entryTool: string | null,
    subtools: string[],
  ) => {
    const groupDir = path.join(toolsPath, dirName);
    fs.mkdirSync(groupDir, { recursive: true });

    const manifest: Partial<GroupManifest> = {
      group_name: groupName,
      subtools,
    };
    if (entryTool) {
      manifest.entry_tool = entryTool;
      createToolInGroup(dirName, entryTool, { name: entryTool });
    }

    fs.writeFileSync(
      path.join(groupDir, 'group_manifest.json'),
      JSON.stringify(manifest),
    );

    for (const subtool of subtools) {
      createToolInGroup(dirName, subtool, { name: subtool });
    }
  };

  const createToolInGroup = (
    groupDirName: string,
    toolName: string,
    manifest: ToolManifest,
  ) => {
    const toolDir = path.join(toolsPath, groupDirName, toolName);
    fs.mkdirSync(toolDir, { recursive: true });
    fs.writeFileSync(
      path.join(toolDir, 'manifest.json'),
      JSON.stringify(manifest),
    );
  };

  it('test_empty_registry_when_no_tools', () => {
    const registry = new ToolRegistry(tempDir);
    expect(registry.allTools()).toEqual([]);
    expect(registry.find('nonexistent')).toBeNull();
  });

  it('test_register_standalone_tool', () => {
    createTool('bash', {
      name: 'bash',
      description: 'Run bash commands',
      parameters: { command: 'string' },
    });

    const registry = new ToolRegistry(tempDir);

    expect(registry.allTools()).toContain('bash');
    const tool = registry.find('bash');
    expect(tool).not.toBeNull();
    expect(tool?.manifest.name).toBe('bash');
    expect(tool?.group).toBeNull();
  });

  it('test_multiple_standalone_tools', () => {
    createTool('bash', { name: 'bash' });
    createTool('read_file', { name: 'read_file' });
    createTool('write_file', { name: 'write_file' });

    const registry = new ToolRegistry(tempDir);

    expect(registry.allTools().length).toBe(3);
    expect(registry.allTools()).toContain('bash');
    expect(registry.allTools()).toContain('read_file');
    expect(registry.allTools()).toContain('write_file');
  });

  it('test_tool_uses_directory_name_if_manifest_missing_name', () => {
    createTool('my_custom_tool', {
      description: 'No name field',
    });

    const registry = new ToolRegistry(tempDir);

    expect(registry.allTools()).toContain('my_custom_tool');
  });

  it('test_tool_directory_without_manifest_ignored', () => {
    const toolDir = path.join(toolsPath, 'incomplete_tool');
    fs.mkdirSync(toolDir, { recursive: true });

    const registry = new ToolRegistry(tempDir);

    expect(registry.allTools()).not.toContain('incomplete_tool');
  });

  it('test_register_tool_group', () => {
    createToolGroup('browser', 'browser', 'navigate', [
      'click',
      'type',
      'screenshot',
    ]);

    const registry = new ToolRegistry(tempDir);

    expect(registry.allTools()).toContain('navigate');
    expect(registry.allTools()).toContain('click');
    expect(registry.allTools()).toContain('type');
    expect(registry.allTools()).toContain('screenshot');

    expect(registry.groupFor('navigate')).toBe('browser');
    expect(registry.groupFor('click')).toBe('browser');
    expect(registry.groupFor('type')).toBe('browser');
    expect(registry.groupFor('screenshot')).toBe('browser');
  });

  it('test_group_without_entry_tool_still_registers_subtools', () => {
    createToolGroup('files', 'files', null, ['read', 'write', 'delete']);

    const registry = new ToolRegistry(tempDir);

    expect(registry.allTools()).not.toContain('entry');
    expect(registry.allTools()).toContain('read');
    expect(registry.allTools()).toContain('write');
    expect(registry.allTools()).toContain('delete');
  });

  it('test_invalid_group_manifest_skipped', () => {
    const groupDir = path.join(toolsPath, 'broken_group');
    fs.mkdirSync(groupDir, { recursive: true });
    fs.writeFileSync(
      path.join(groupDir, 'group_manifest.json'),
      'invalid json {{{',
    );

    expect(() => {
      const registry = new ToolRegistry(tempDir);
      registry.allTools();
    }).not.toThrow();
  });

  it('test_invalid_tool_manifest_skipped', () => {
    const toolDir = path.join(toolsPath, 'broken_tool');
    fs.mkdirSync(toolDir, { recursive: true });
    fs.writeFileSync(path.join(toolDir, 'manifest.json'), 'not valid json');

    const registry = new ToolRegistry(tempDir);

    expect(registry.allTools()).not.toContain('broken_tool');
  });

  it('test_find_returns_null_for_nonexistent', () => {
    const registry = new ToolRegistry(tempDir);
    expect(registry.find('does_not_exist')).toBeNull();
  });

  it('test_group_for_returns_null_for_standalone', () => {
    createTool('standalone', { name: 'standalone' });

    const registry = new ToolRegistry(tempDir);

    expect(registry.groupFor('standalone')).toBeNull();
  });

  it('test_hot_refresh_when_files_change', async () => {
    const registry = new ToolRegistry(tempDir);
    expect(registry.allTools().length).toBe(0);

    // Wait slightly to ensure mtime differences on filesystems
    await new Promise((resolve) => setTimeout(resolve, 100));

    createTool('new_tool', { name: 'new_tool' });

    expect(registry.allTools()).toContain('new_tool');
  });

  it('test_no_refresh_when_files_unchanged', () => {
    createTool('existing', { name: 'existing' });

    const registry = new ToolRegistry(tempDir);
    const initialTools = registry.allTools();

    const toolsAfter = registry.allTools();
    expect(initialTools.sort()).toEqual(toolsAfter.sort());
  });

  it('test_multiple_groups', () => {
    createToolGroup('browser', 'browser', 'navigate', ['click']);
    createToolGroup('files', 'files', 'list', ['read', 'write']);

    const registry = new ToolRegistry(tempDir);

    expect(registry.groupFor('navigate')).toBe('browser');
    expect(registry.groupFor('click')).toBe('browser');
    expect(registry.groupFor('list')).toBe('files');
    expect(registry.groupFor('read')).toBe('files');
    expect(registry.groupFor('write')).toBe('files');
  });

  it('test_tool_info_contains_path_and_manifest', () => {
    const manifest = {
      name: 'test_tool',
      description: 'Test description',
      parameters: { arg1: 'string' },
    };
    createTool('test_tool', manifest);

    const registry = new ToolRegistry(tempDir);
    const tool = registry.find('test_tool');

    expect(tool).not.toBeNull();
    expect(path.dirname(tool?.path || '')).toBe(toolsPath);
    expect(tool?.manifest).toEqual(manifest);
    expect(tool?.manifest.name).toBe('test_tool');
  });

  it('test_scan_forces_rescan', () => {
    createTool('tool1', { name: 'tool1' });

    const registry = new ToolRegistry(tempDir);
    expect(registry.allTools()).toContain('tool1');

    createTool('tool2', { name: 'tool2' });

    registry.scan();

    expect(registry.allTools()).toContain('tool1');
    expect(registry.allTools()).toContain('tool2');
  });

  it('test_nonexistent_project_path_handled', () => {
    const nonexistent = path.join(tempDir, 'nonexistent_project');
    expect(() => {
      const registry = new ToolRegistry(nonexistent);
      expect(registry.allTools()).toEqual([]);
    }).not.toThrow();
  });

  it('test_tool_with_complex_manifest', () => {
    const complexManifest = {
      name: 'complex_tool',
      description: 'A complex tool',
      version: '1.0.0',
      parameters: {
        required: ['arg1'],
        properties: {
          arg1: { type: 'string', description: 'First arg' },
          arg2: { type: 'number', description: 'Second arg' },
        },
      },
      metadata: {
        author: 'test',
        tags: ['test', 'example'],
      },
    };

    createTool('complex_tool', complexManifest);

    const registry = new ToolRegistry(tempDir);
    const tool = registry.find('complex_tool');

    expect(tool).not.toBeNull();
    expect(tool?.manifest).toEqual(complexManifest);
    expect((tool?.manifest as any).version).toBe('1.0.0');
    expect((tool?.manifest as any).metadata.tags).toEqual(['test', 'example']);
  });

  it('test_group_name_from_manifest', () => {
    createToolGroup('my_group', 'custom_group_name', 'entry', ['sub1']);

    const registry = new ToolRegistry(tempDir);

    expect(registry.groupFor('entry')).toBe('custom_group_name');
    expect(registry.groupFor('sub1')).toBe('custom_group_name');
  });

  it('test_empty_subtools_list', () => {
    const groupDir = path.join(toolsPath, 'minimal_group');
    fs.mkdirSync(groupDir, { recursive: true });
    fs.writeFileSync(
      path.join(groupDir, 'group_manifest.json'),
      JSON.stringify({
        group_name: 'minimal',
        entry_tool: 'entry',
      }),
    );

    createToolInGroup('minimal_group', 'entry', { name: 'entry' });

    const registry = new ToolRegistry(tempDir);

    expect(registry.allTools()).toContain('entry');
    expect(registry.allTools().length).toBe(1);
  });

  it('test_nested_standalone_tool', () => {
    const nestedDir = path.join(
      toolsPath,
      'category',
      'subcategory',
      'my_nested_tool',
    );
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(
      path.join(nestedDir, 'manifest.json'),
      JSON.stringify({
        name: 'my_nested_tool',
        description: 'A nested tool',
      }),
    );

    const registry = new ToolRegistry(tempDir);

    expect(registry.allTools()).toContain('my_nested_tool');
    const tool = registry.find('my_nested_tool');
    expect(tool).not.toBeNull();
    expect(tool?.manifest.name).toBe('my_nested_tool');
    expect(tool?.group).toBeNull();
  });

  it('test_nested_group_tool', () => {
    const nestedGroupDir = path.join(toolsPath, 'category', 'my_group');
    fs.mkdirSync(nestedGroupDir, { recursive: true });
    fs.writeFileSync(
      path.join(nestedGroupDir, 'group_manifest.json'),
      JSON.stringify({
        group_name: 'nested_group',
        entry_tool: 'open',
        subtools: ['click'],
      }),
    );

    // Create entry tool
    const openDir = path.join(nestedGroupDir, 'open');
    fs.mkdirSync(openDir, { recursive: true });
    fs.writeFileSync(
      path.join(openDir, 'manifest.json'),
      JSON.stringify({ name: 'nested_open' }),
    );

    // Create subtool
    const clickDir = path.join(nestedGroupDir, 'click');
    fs.mkdirSync(clickDir, { recursive: true });
    fs.writeFileSync(
      path.join(clickDir, 'manifest.json'),
      JSON.stringify({ name: 'nested_click' }),
    );

    const registry = new ToolRegistry(tempDir);

    expect(registry.allTools()).toContain('nested_open');
    expect(registry.allTools()).toContain('nested_click');
    expect(registry.groupFor('nested_open')).toBe('nested_group');
    expect(registry.groupFor('nested_click')).toBe('nested_group');
  });

  it('test_nested_hot_refresh', async () => {
    const registry = new ToolRegistry(tempDir);
    expect(registry.allTools().length).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const nestedDir = path.join(
      toolsPath,
      'category',
      'subcategory',
      'new_nested_tool',
    );
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(
      path.join(nestedDir, 'manifest.json'),
      JSON.stringify({ name: 'new_nested_tool' }),
    );

    expect(registry.allTools()).toContain('new_nested_tool');
  });
});

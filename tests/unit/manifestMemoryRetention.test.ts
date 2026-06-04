import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { fileURLToPath } from 'node:url';
import { ToolRegistry } from '../../src/core/kernel/registry.js';
import { MemoryPolicy } from '../../src/core/memory/policy.js';
import { Runner } from '../../src/core/kernel/runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('ManifestMemoryRetention', () => {
  const appPath = path.resolve(__dirname, 'tmp_manifest_memory');
  const toolsDir = path.join(appPath, 'tools');
  const configDir = path.join(appPath, 'config');

  beforeAll(() => {
    if (!fs.existsSync(appPath)) {
      fs.mkdirSync(appPath, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(appPath)) {
      fs.rmSync(appPath, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    if (fs.existsSync(toolsDir)) {
      fs.rmSync(toolsDir, { recursive: true, force: true });
    }
    fs.mkdirSync(toolsDir, { recursive: true });

    if (fs.existsSync(configDir)) {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
    fs.mkdirSync(configDir, { recursive: true });

    const configContent = {
      state_management: {
        max_state_chars: 100000,
        recent_events_n: 20,
        summarization: {
          enabled: true,
          max_chars: 500,
        },
        retention: {
          execution: { max_steps: 10, summarize: true },
        },
      },
    };
    fs.writeFileSync(path.join(configDir, 'config.yml'), yaml.stringify(configContent));
  });

  const createTool = (name: string, manifest: any) => {
    const toolDir = path.join(toolsDir, name);
    fs.mkdirSync(toolDir, { recursive: true });
    fs.writeFileSync(path.join(toolDir, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(toolDir, 'logic.py'), "print('ok')");
  };

  it('test_read_memory_config_from_manifest', () => {
    const manifest = {
      name: 'bash_command',
      description: 'Run shell commands',
      memory: {
        retention: 'ephemeral',
        summarize: true,
        max_steps: 5,
      },
    };
    createTool('bash_command', manifest);

    const registry = new ToolRegistry(appPath);
    registry.scan();

    const toolData = registry.find('bash_command');
    expect(toolData).not.toBeNull();

    const memoryConfig = toolData!.manifest.memory;
    expect(memoryConfig).not.toBeNull();
    expect(memoryConfig.retention).toBe('ephemeral');
    expect(memoryConfig.summarize).toBe(true);
    expect(memoryConfig.max_steps).toBe(5);
  });

  it('test_metabolizer_reads_manifest_retention', () => {
    const manifest = {
      name: 'bash_command',
      memory: {
        retention: 'ephemeral',
        summarize: true,
        max_steps: 3,
      },
    };
    createTool('bash_command', manifest);

    const registry = new ToolRegistry(appPath);
    registry.scan();

    const policy = new MemoryPolicy({ registry });
    const policyData = (policy as any).getManifestRetention('bash_command');
    expect(policyData).not.toBeNull();
    expect(policyData.max_steps).toBe(3);
    expect(policyData.summarize).toBe(true);
    expect(policyData.retention).toBe('ephemeral');
  });

  it('test_manifest_policy_overrides_global_config', () => {
    const manifest = {
      name: 'custom_tool',
      memory: {
        retention: 'permanent',
        summarize: false,
      },
    };
    createTool('custom_tool', manifest);

    const registry = new ToolRegistry(appPath);
    registry.scan();

    const policy = new MemoryPolicy({ registry });
    const policyData = (policy as any).getRetentionPolicy('execution', 'custom_tool');
    expect(policyData.summarize).toBe(false);
    expect(policyData.max_steps).toBe(50); // Default max steps for working tier
  });

  it('test_fallback_to_global_config', () => {
    const manifest = {
      name: 'simple_tool',
      description: 'No memory config',
    };
    createTool('simple_tool', manifest);

    const registry = new ToolRegistry(appPath);
    registry.scan();

    const configPath = path.join(appPath, 'config', 'config.yml');
    const cfg = yaml.parse(fs.readFileSync(configPath, 'utf-8')) || {};
    const policy = new MemoryPolicy({
      registry,
      retention: cfg.state_management?.retention,
    });

    const policyData = (policy as any).getRetentionPolicy('execution', 'simple_tool');
    expect(policyData).not.toBeNull();
    expect(policyData.max_steps).toBe(10);
    expect(policyData.summarize).toBe(true);
  });

  it('test_fallback_to_defaults', () => {
    const registry = new ToolRegistry(appPath);
    const policy = new MemoryPolicy({ registry });

    const policyData = (policy as any).getRetentionPolicy('unknown_phase', 'nonexistent_tool');
    expect(policyData.max_steps).toBe(50);
    expect(policyData.summarize).toBe(false);
  });

  it('test_apply_retention_policy_with_manifest', () => {
    const manifest = {
      name: 'temp_tool',
      memory: {
        retention: 'ephemeral',
        summarize: true,
        max_steps: 2,
      },
    };
    createTool('temp_tool', manifest);

    const registry = new ToolRegistry(appPath);
    registry.scan();

    const policy = new MemoryPolicy({ registry });

    const events = [
      { id: 1, phase: 'execution', tool: 'temp_tool', timestamp: 1000 },
      { id: 2, phase: 'execution', tool: 'temp_tool', timestamp: 2000 },
      { id: 3, phase: 'plan', tool: null, timestamp: 3000 },
    ];

    const result = policy.apply(events);

    const tempToolEvents = result.to_summarize.filter(e => e.tool === 'temp_tool');
    expect(tempToolEvents.length).toBe(2);

    const planEvents = result.to_delete.filter(e => e.phase === 'plan');
    expect(planEvents.length).toBe(1);
  });

  it('test_permanent_retention_from_manifest', () => {
    const manifest = {
      name: 'milestone_tool',
      memory: {
        retention: 'permanent',
        summarize: false,
        permanent: true,
      },
    };
    createTool('milestone_tool', manifest);

    const registry = new ToolRegistry(appPath);
    registry.scan();

    const policy = new MemoryPolicy({ registry });

    const events = [
      { id: 1, phase: 'execution', tool: 'milestone_tool', timestamp: 1000 },
      { id: 2, phase: 'execution', tool: 'other_tool', timestamp: 2000 },
    ];

    const result = policy.apply(events);

    const keptEvents = result.to_keep;
    expect(keptEvents.length).toBe(1);
    expect(keptEvents[0].tool).toBe('milestone_tool');

    const deletedEvents = result.to_delete;
    expect(deletedEvents.length).toBe(1);
    expect(deletedEvents[0].tool).toBe('other_tool');
  });

  it('test_multiple_tools_different_tiers', () => {
    createTool('ephemeral_tool', {
      name: 'ephemeral_tool',
      memory: { retention: 'ephemeral', summarize: true, max_steps: 3 },
    });

    createTool('working_tool', {
      name: 'working_tool',
      memory: { retention: 'working', summarize: false, max_steps: 50 },
    });

    createTool('permanent_tool', {
      name: 'permanent_tool',
      memory: { retention: 'permanent', summarize: false, permanent: true },
    });

    const registry = new ToolRegistry(appPath);
    registry.scan();

    const policy = new MemoryPolicy({ registry });

    const events = [
      { id: 1, phase: 'execution', tool: 'ephemeral_tool', timestamp: 1000 },
      { id: 2, phase: 'execution', tool: 'working_tool', timestamp: 2000 },
      { id: 3, phase: 'execution', tool: 'permanent_tool', timestamp: 3000 },
    ];

    const result = policy.apply(events);

    expect(result.to_summarize.length).toBe(1);
    expect(result.to_summarize[0].tool).toBe('ephemeral_tool');

    const workingDeleted = result.to_delete.filter(e => e.tool === 'working_tool');
    expect(workingDeleted.length).toBe(1);

    expect(result.to_keep.length).toBe(1);
    expect(result.to_keep[0].tool).toBe('permanent_tool');
  });

  it('test_manifest_without_memory_field', () => {
    const manifest = {
      name: 'no_memory_tool',
      description: 'No memory configuration',
    };
    createTool('no_memory_tool', manifest);

    const registry = new ToolRegistry(appPath);
    registry.scan();

    const policy = new MemoryPolicy({ registry });

    const policyData = (policy as any).getManifestRetention('no_memory_tool');
    expect(policyData).toBeNull();

    const fallbackPolicy = (policy as any).getRetentionPolicy('execution', 'no_memory_tool');
    expect(fallbackPolicy).not.toBeNull();
  });

  it('test_incomplete_memory_config', () => {
    const manifest = {
      name: 'partial_tool',
      memory: {
        retention: 'working',
      },
    };
    createTool('partial_tool', manifest);

    const registry = new ToolRegistry(appPath);
    registry.scan();

    const policy = new MemoryPolicy({ registry });

    const policyData = (policy as any).getManifestRetention('partial_tool');
    expect(policyData).not.toBeNull();
    expect(policyData.retention).toBe('working');
    expect(policyData.summarize).toBe(false);
    expect(policyData.max_steps).toBe(50);
  });

  it('test_runner_propagates_registry_to_memory_base_and_policy', () => {
    createTool('runner_test_tool', {
      name: 'runner_test_tool',
      memory: {
        retention: 'ephemeral',
        summarize: true,
      },
    });

    const runner = new Runner(appPath);

    // 1. Check registry is propagated to Memory Base
    expect((runner as any).registry).toBe((runner.memory as any).metabolizer.registry);

    // 2. Check registry is propagated to Metabolizer
    expect((runner as any).registry).toBe((runner.memory as any).metabolizer.registry);

    // 3. Check registry is propagated to Policy
    const policy = (runner.memory as any).metabolizer.policy;
    expect((runner as any).registry).toBe(policy.registry);

    // 4. Check policy retrieves custom setting correctly
    const policyData = (policy as any).getRetentionPolicy('execution', 'runner_test_tool');
    expect(policyData.summarize).toBe(true);
    expect(policyData.retention).toBe('ephemeral');
  });
});

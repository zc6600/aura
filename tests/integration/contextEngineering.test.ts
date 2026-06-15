import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'yaml';
import { Hints } from '../../src/cli/commands/hints.js';
import { ContextAssembler } from '../../src/core/context/assembler.js';
import { ContextBase } from '../../src/core/context/base.js';
import { KnowledgeProvider } from '../../src/core/context/providers/knowledgeProvider.js';
import { ToolProvider } from '../../src/core/context/providers/toolProvider.js';

import type {
  EventRecord,
  SummaryRecord,
} from '../../src/core/memory/sqliteStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DummyContextDb {
  public variables: Record<string, string> = {};
  public summaries: SummaryRecord[] = [];
  public events: EventRecord[] = [];

  public allVariables(): Record<string, string> {
    return this.variables;
  }

  public fetchEvents(options: {
    limit?: number;
    offset?: number;
  }): EventRecord[] {
    const limit = options.limit ?? this.events.length;
    const offset = options.offset ?? 0;
    return this.events.slice(offset, offset + limit);
  }

  public fetchSummaries(options: { limit?: number }): SummaryRecord[] {
    const limit = options.limit ?? this.summaries.length;
    return this.summaries.slice(0, limit);
  }

  public countEvents(): number {
    return this.events.length;
  }
}

describe('Context Engineering Integration', { timeout: 15000 }, () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = path.resolve(__dirname, `temp-ctx-eng-${Date.now()}`);
    fs.mkdirSync(projectPath, { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'config'), { recursive: true });

    // Write a base config.yml
    fs.writeFileSync(
      path.join(projectPath, 'config', 'config.yml'),
      yaml.stringify({
        state_management: {
          max_state_chars: 50000,
        },
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(projectPath)) {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('test_discard_order_preserves_directive_and_task', () => {
    // Write tiny limit to force discard/compression
    fs.writeFileSync(
      path.join(projectPath, 'config', 'config.yml'),
      yaml.stringify({
        state_management: {
          max_state_chars: 1000,
        },
      }),
    );

    // Create directive and task.md
    fs.mkdirSync(path.join(projectPath, 'skills'), { recursive: true });
    fs.writeFileSync(
      path.join(projectPath, 'skills', 'system.md'),
      '# AURA OS OPERATING PROTOCOL\nCORE_AURA_DIRECTIVE_RULE',
    );
    fs.writeFileSync(path.join(projectPath, 'task.md'), 'URGENT_TASK_NAME');

    // Create massive workspace file
    fs.writeFileSync(
      path.join(projectPath, 'AURA_README.md'),
      'A'.repeat(5000),
    );

    const db = new DummyContextDb();
    const payload = ContextAssembler.assemble(projectPath, db as any);
    const out = payload.toMarkdown();

    expect(out).toContain('CORE_AURA_DIRECTIVE_RULE');
    expect(out).toContain('URGENT_TASK_NAME');
    expect(out).not.toContain('A'.repeat(5000));
  });

  it('test_magic_hint_scanning_skips_large_files', () => {
    fs.writeFileSync(
      path.join(projectPath, 'small.py'),
      '# @aura-hint: Valid Hint Here',
    );
    fs.writeFileSync(
      path.join(projectPath, 'large.py'),
      `# @aura-hint: Large Hint Should Not Show
${'#'.repeat(110000)}`,
    );

    const base = new ContextBase(projectPath, null as any);
    const out = base.buildEnvironmentContent();

    expect(out).toContain('Valid Hint Here');
    expect(out).not.toContain('Large Hint Should Not Show');
  });

  it('test_has_magic_hint_reads_only_4kb_buffer', () => {
    // Create a very large file (> 100KB) with @aura-hint: in the first 4KB, and verify it returns true.
    const largeFilePath = path.join(projectPath, 'large_hint_file.py');
    const header = '# @aura-hint: My optimized magic hint\n';
    const body = 'B'.repeat(150000); // 150KB
    fs.writeFileSync(largeFilePath, header + body);

    const hasHint = (Hints as any).hasMagicHint(largeFilePath);
    expect(hasHint).toBe(true);

    // Create another large file with @aura-hint: AFTER the first 4KB, and verify it returns false (since we only scan the first 4KB).
    const largeFileNoHintInHeaderPath = path.join(
      projectPath,
      'large_no_hint_in_header.py',
    );
    const headerNoHint = `${'B'.repeat(5000)}\n`;
    const bodyWithHint = '# @aura-hint: This should not be scanned\n';
    fs.writeFileSync(largeFileNoHintInHeaderPath, headerNoHint + bodyWithHint);

    const hasHint2 = (Hints as any).hasMagicHint(largeFileNoHintInHeaderPath);
    expect(hasHint2).toBe(false);
  });

  it('test_magic_hint_scanning_truncates_and_warns_on_long_hints', () => {
    const longHint = 'X'.repeat(1200);
    fs.writeFileSync(
      path.join(projectPath, 'long_hint.py'),
      `# @aura-hint: ${longHint}`,
    );

    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    const base = new ContextBase(projectPath, null as any);
    const out = base.buildEnvironmentContent();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[WARNING] Aura-hint in long_hint.py was truncated because it exceeds the 1000 character limit',
      ),
    );
    expect(out).toContain('X'.repeat(1000));
    expect(out).toContain('... [truncated: hint exceeds 1000 character limit]');
    expect(out).not.toContain('X'.repeat(1200));

    // Custom limit check
    fs.writeFileSync(
      path.join(projectPath, 'config', 'config.yml'),
      yaml.stringify({
        state_management: { max_state_chars: 50000 },
        hints: { max_hint_chars: 50 },
      }),
    );

    consoleWarnSpy.mockClear();

    const base2 = new ContextBase(projectPath, null as any);
    const out2 = base2.buildEnvironmentContent();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[WARNING] Aura-hint in long_hint.py was truncated because it exceeds the 50 character limit',
      ),
    );
    expect(out2).toContain('X'.repeat(50));
    expect(out2).toContain('... [truncated: hint exceeds 50 character limit]');
    expect(out2).not.toContain('X'.repeat(100));
  });

  it('test_active_variables_truncation', () => {
    const db = new DummyContextDb();
    db.variables = {
      huge_var: 'Y'.repeat(15000),
      small_var: 'short',
    };

    const payload = ContextAssembler.assemble(projectPath, db as any);
    const out = payload.toMarkdown();

    expect(out).toContain('huge_var');
    expect(out).toContain('Y'.repeat(10000));
    expect(out).toContain('... [truncated]');
    expect(out).not.toContain('Y'.repeat(15000));
    expect(out).toContain('small_var: short');
  });

  it('test_aura_readme_auto_inject_configuration', () => {
    fs.writeFileSync(
      path.join(projectPath, 'AURA_README.md'),
      'WORKSPACE_RULE_README_CONTENT',
    );

    // Default: auto injects
    const base = new ContextBase(projectPath, null as any);
    const out1 = base.buildEnvironmentContent();
    expect(out1).toContain('WORKSPACE_RULE_README_CONTENT');

    // Disable auto inject
    fs.writeFileSync(
      path.join(projectPath, 'config', 'config.yml'),
      yaml.stringify({
        state_management: { max_state_chars: 50000 },
        hints: { auto_inject_readme: false },
      }),
    );

    const base2 = new ContextBase(projectPath, null as any);
    const out2 = base2.buildEnvironmentContent();
    expect(out2).not.toContain('WORKSPACE_RULE_README_CONTENT');
  });

  it('test_readme_and_hint_10000_char_limits', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    fs.writeFileSync(
      path.join(projectPath, 'AURA_README.md'),
      'R'.repeat(12000),
    );

    fs.mkdirSync(path.join(projectPath, 'knowledge'), { recursive: true });
    fs.writeFileSync(
      path.join(projectPath, 'knowledge', 'doc.txt'),
      'some content',
    );
    fs.writeFileSync(
      path.join(projectPath, 'knowledge', 'doc.txt.hint'),
      'K'.repeat(12000),
    );

    fs.mkdirSync(path.join(projectPath, 'tools', 'my_tool'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(projectPath, 'tools', 'my_tool', 'manifest.json'),
      JSON.stringify({ name: 'my_tool', auto_load: true }),
    );
    fs.writeFileSync(
      path.join(projectPath, 'tools', 'my_tool', 'my_tool.hint'),
      'T'.repeat(12000),
    );

    fs.writeFileSync(
      path.join(projectPath, 'config', 'config.yml'),
      yaml.stringify({
        hints: { auto_inject_readme: true },
      }),
    );

    const base = new ContextBase(projectPath, null as any);
    const out = base.buildEnvironmentContent();

    expect(out).toContain('R'.repeat(10000));
    expect(out).toContain('... [truncated: exceeds 10000 character limit]');
    expect(out).not.toContain('R'.repeat(12000));

    const kp = new KnowledgeProvider(projectPath);
    const kOut = kp.provide();
    expect(kOut).toContain('K'.repeat(10000));
    expect(kOut).toContain('... [truncated]');
    expect(kOut).not.toContain('K'.repeat(12000));

    const tp = new ToolProvider(projectPath);
    const tOut = tp.provide();
    expect(tOut).toContain('T'.repeat(10000));
    expect(tOut).toContain('... [truncated]');
    expect(tOut).not.toContain('T'.repeat(12000));

    // Custom 50 chars limit checks
    fs.writeFileSync(
      path.join(projectPath, 'config', 'config.yml'),
      yaml.stringify({
        hints: {
          auto_inject_readme: true,
          max_file_chars: 50,
        },
      }),
    );

    const baseCustom = new ContextBase(projectPath, null as any);
    const outCustom = baseCustom.buildEnvironmentContent();
    expect(outCustom).toContain('R'.repeat(50));
    expect(outCustom).toContain('... [truncated: exceeds 50 character limit]');
    expect(outCustom).not.toContain('R'.repeat(51));

    const kpCustom = new KnowledgeProvider(projectPath);
    const kOutCustom = kpCustom.provide();
    expect(kOutCustom).toContain('K'.repeat(50));
    expect(kOutCustom).toContain('... [truncated]');
    expect(kOutCustom).not.toContain('K'.repeat(51));

    const tpCustom = new ToolProvider(projectPath);
    const tOutCustom = tpCustom.provide();
    expect(tOutCustom).toContain('T'.repeat(50));
    expect(tOutCustom).toContain('... [truncated]');
    expect(tOutCustom).not.toContain('T'.repeat(51));
  });

  it('test_ignore_list_skips_files', () => {
    fs.writeFileSync(path.join(projectPath, 'AURA_README.md'), 'README_RULE');

    fs.mkdirSync(path.join(projectPath, 'knowledge'), { recursive: true });
    fs.writeFileSync(path.join(projectPath, 'knowledge', 'doc.txt'), 'content');
    fs.writeFileSync(
      path.join(projectPath, 'knowledge', 'doc.txt.hint'),
      'KNOWLEDGE_HINT',
    );

    fs.mkdirSync(path.join(projectPath, 'tools', 'my_tool'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(projectPath, 'tools', 'my_tool', 'manifest.json'),
      JSON.stringify({ name: 'my_tool', auto_load: true }),
    );
    fs.writeFileSync(
      path.join(projectPath, 'tools', 'my_tool', 'my_tool.hint'),
      'TOOL_HINT',
    );

    fs.writeFileSync(
      path.join(projectPath, 'magic.py'),
      '# @aura-hint: MAGIC_HINT_HERE\npass',
    );

    // Ignore everything
    fs.writeFileSync(
      path.join(projectPath, 'config', 'config.yml'),
      yaml.stringify({
        hints: {
          ignore_list: [
            'AURA_README.md',
            'knowledge/doc.txt.hint',
            'tools/my_tool/my_tool.hint',
            'magic.py',
          ],
        },
      }),
    );

    const base = new ContextBase(projectPath, null as any);
    const out = base.buildEnvironmentContent();

    expect(out).not.toContain('README_RULE');
    expect(out).not.toContain('KNOWLEDGE_HINT');
    expect(out).not.toContain('MAGIC_HINT_HERE');

    const tp = new ToolProvider(projectPath);
    const toolOut = tp.provide();
    expect(toolOut).not.toContain('TOOL_HINT');
  });

  it('test_hints_cli_command', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Create workspace directory config
    const auraDir = path.join(projectPath, '.aura-workspace');
    fs.mkdirSync(path.join(auraDir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(projectPath, 'AURA_README.md'), 'README_RULE');
    fs.writeFileSync(
      path.join(auraDir, 'config', 'config.yml'),
      yaml.stringify({
        hints: { auto_inject_readme: true },
      }),
    );

    // List command
    await Hints.list(projectPath);
    const listOutput = consoleLogSpy.mock.calls
      .map((c) => c.join(' '))
      .join('\n');
    expect(listOutput).toContain('AURA_README.md');
    expect(listOutput).toContain('INJECTED');

    // Toggle off
    consoleLogSpy.mockClear();
    Hints.toggle('AURA_README.md', projectPath);

    const cfg = yaml.parse(
      fs.readFileSync(path.join(auraDir, 'config', 'config.yml'), 'utf-8'),
    );
    expect(cfg.hints?.auto_inject_readme).toBe(false);

    // Toggle on
    Hints.toggle('AURA_README.md', projectPath);
    const cfgAfter = yaml.parse(
      fs.readFileSync(path.join(auraDir, 'config', 'config.yml'), 'utf-8'),
    );
    expect(cfgAfter.hints?.auto_inject_readme).toBe(true);
  });

  it('test_ralph_loop_to_messages_includes_workspace_and_task', () => {
    // Create directive, task.md, and AGENTS.md
    fs.mkdirSync(path.join(projectPath, 'skills'), { recursive: true });
    fs.writeFileSync(
      path.join(projectPath, 'skills', 'ralph_system.md'),
      '# AURA OS OPERATING PROTOCOL\nCORE_AURA_DIRECTIVE_RULE',
    );
    fs.writeFileSync(path.join(projectPath, 'task.md'), 'URGENT_TASK_NAME');
    fs.writeFileSync(
      path.join(projectPath, 'AGENTS.md'),
      'AGENTS_INSTRUCTIONS_CONTENT',
    );

    const db = new DummyContextDb();
    const payload = ContextAssembler.assemble(projectPath, db as any, {
      directive_mode: 'ralph_developer',
    });

    const messages = payload.toMessages({ goal: 'Fix the bug' });
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('CORE_AURA_DIRECTIVE_RULE');
    expect(messages[0].content).toContain('AGENTS_INSTRUCTIONS_CONTENT');
    expect(messages[0].content).toContain('URGENT_TASK_NAME');

    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('Fix the bug');
  });
});

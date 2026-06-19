import fs from 'node:fs';
import path from 'node:path';
import picocolors from 'picocolors';
import * as PathResolver from '../../utils/pathResolver.js';
import * as UI from '../ui.js';
import { Tools } from './tools.js';

export interface ToolCreateOptions {
  runtime?: string;
  autoLoad?: boolean;
  allowPath?: string;
  shell?: boolean;
}

const SCAFFOLD_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export class Create {
  public static tool(name: string, options: ToolCreateOptions = {}): void {
    const root = Create.resolveWorkspaceRoot();
    const normalized = Create.validateName(name, 'tool');
    const toolDir = path.join(root, 'tools', normalized);
    Create.ensureMissing(toolDir, `Tool '${normalized}' already exists`);

    const runtime = options.runtime || 'python3';
    const allowPaths = Create.parseAllowPaths(options.allowPath);
    const manifest = {
      name: normalized,
      description: `TODO: Describe what ${normalized} does.`,
      runtime,
      entry: 'logic.py',
      auto_load: options.autoLoad ?? false,
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
      permissions: {
        file_system: allowPaths.length > 0 ? 'read-write' : 'read-only',
        allow_paths: allowPaths.length > 0 ? allowPaths : ['.'],
        shell: options.shell ?? false,
        self_edit: false,
      },
      memory: {
        retention: 'ephemeral',
        summarize: true,
        max_steps: 5,
      },
    };

    fs.mkdirSync(toolDir, { recursive: true });
    Create.writeJson(path.join(toolDir, 'manifest.json'), manifest);
    fs.writeFileSync(path.join(toolDir, 'logic.py'), Create.toolLogic(), {
      encoding: 'utf-8',
      mode: 0o755,
    });
    fs.writeFileSync(
      path.join(toolDir, 'logic.py.hint'),
      [
        `Use ${normalized} for TODO: describe the reliable operation it performs.`,
        'Input must match manifest.json input_schema.',
        'Output must be one JSON object with status "ok" or "failed".',
        '',
      ].join('\n'),
      'utf-8',
    );

    UI.printSuccess(
      `Created tool scaffold at ${Create.relative(root, toolDir)}`,
    );
  }

  public static toolGroup(name: string, subtools: string[]): void {
    Create.resolveWorkspaceRoot();
    const normalized = Create.validateName(name, 'tool group');
    for (const subtool of subtools) {
      Create.validateName(subtool, 'subtool');
    }
    Tools.generateGroup(normalized, subtools);
  }

  public static skill(name: string): void {
    const root = Create.resolveWorkspaceRoot();
    const normalized = Create.validateName(name, 'skill');
    const skillDir = path.join(root, 'skills', normalized);
    Create.ensureMissing(skillDir, `Skill '${normalized}' already exists`);

    fs.mkdirSync(path.join(skillDir, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
    fs.mkdirSync(path.join(skillDir, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        `name: ${normalized}`,
        `description: TODO: Describe when to use ${normalized}.`,
        'requires: []',
        '---',
        '',
        `# ${Create.titleize(normalized)}`,
        '',
        'TODO: Add the workflow, decision rules, and expected output format.',
        '',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(skillDir, 'assets', 'README.md'),
      'Store reusable assets for this skill here.\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(skillDir, 'references', 'README.md'),
      'Store reference material for this skill here.\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(skillDir, 'scripts', 'README.md'),
      'Store helper scripts for this skill here.\n',
      'utf-8',
    );

    UI.printSuccess(
      `Created skill scaffold at ${Create.relative(root, skillDir)}`,
    );
  }

  public static garden(name: string): void {
    const root = Create.resolveWorkspaceRoot();
    const normalized = Create.validateName(name, 'garden playbook');
    const gardenRoot = path.join(root, 'garden');
    const playbookDir = path.join(gardenRoot, normalized);
    Create.ensureMissing(
      playbookDir,
      `Garden playbook '${normalized}' already exists`,
    );

    fs.mkdirSync(playbookDir, { recursive: true });
    const routerPath = path.join(gardenRoot, 'garden.md');
    if (!fs.existsSync(routerPath)) {
      fs.writeFileSync(
        routerPath,
        [
          '---',
          'name: garden',
          'description: Workspace garden router.',
          '---',
          '',
          '# Garden Router',
          '',
          'Use domain playbooks under `garden/<name>/garden.md` when they match the task.',
          '',
        ].join('\n'),
        'utf-8',
      );
    }
    fs.writeFileSync(
      path.join(playbookDir, 'garden.md'),
      [
        '---',
        `name: ${normalized}`,
        `description: TODO: Describe when to use the ${normalized} playbook.`,
        'requires: []',
        '---',
        '',
        `# ${Create.titleize(normalized)} Garden`,
        '',
        'TODO: Define phases, constraints, anchors, tools, and handoff rules.',
        '',
      ].join('\n'),
      'utf-8',
    );

    UI.printSuccess(
      `Created garden playbook at ${Create.relative(root, playbookDir)}`,
    );
  }

  public static workflow(name: string): void {
    const root = Create.resolveWorkspaceRoot();
    const normalized = Create.validateName(name, 'workflow');
    const workflowPath = path.join(root, 'workflow.yml');
    Create.ensureMissing(workflowPath, 'workflow.yml already exists');

    fs.writeFileSync(
      workflowPath,
      [
        'version: 1',
        `name: ${normalized}`,
        `description: TODO: Describe the ${normalized} workflow.`,
        '',
        'params:',
        `  path: params/${normalized}.yml`,
        '',
        'context:',
        `  garden: garden/${normalized}/garden.md`,
        `  skill: skills/${normalized}/SKILL.md`,
        '  prompts:',
        '    - prompts/system/SOUL.md',
        '    - prompts/system/TOOLS.md',
        '',
        'tools:',
        '  required: []',
        '',
        'stages:',
        '  - id: ready',
        '    title: Workspace ready',
        '    anchor: anchors/00_ready.json',
        '',
        'run:',
        '  mode: classic',
        '  max_steps: 20',
        '  goal: |',
        `    Use the ${normalized} Garden for project context.`,
        `    Follow the ${normalized} Skill operating procedure.`,
        `    Read params/${normalized}.yml before acting.`,
        '    Use required tools for deterministic actions.',
        '    Stop when the configured stop condition is met.',
        '',
      ].join('\n'),
      'utf-8',
    );

    UI.printSuccess(`Created workflow scaffold at workflow.yml`);
  }

  public static persona(name: string): void {
    const root = Create.resolveWorkspaceRoot();
    const normalized = Create.validateName(name, 'persona');
    const personaPath = path.join(
      root,
      'state',
      'personas',
      `${normalized}.json`,
    );
    Create.ensureMissing(personaPath, `Persona '${normalized}' already exists`);

    fs.mkdirSync(path.dirname(personaPath), { recursive: true });
    Create.writeJson(personaPath, {
      instructions: `TODO: Describe the ${normalized} role, constraints, and expected output.`,
    });

    UI.printSuccess(
      `Created persona scaffold at ${Create.relative(root, personaPath)}`,
    );
  }

  public static anchor(id: string): void {
    const root = Create.resolveWorkspaceRoot();
    const normalized = Create.validateName(id, 'anchor');
    const anchorPath = path.join(root, 'anchors', `${normalized}.json`);
    Create.ensureMissing(anchorPath, `Anchor '${normalized}' already exists`);

    fs.mkdirSync(path.dirname(anchorPath), { recursive: true });
    Create.writeJson(anchorPath, {
      id: normalized,
      description: `TODO: Describe the milestone for ${normalized}.`,
      success_criteria: ['TODO: Define observable completion criteria.'],
      verify: 'TODO: Describe how to verify this anchor.',
    });

    UI.printSuccess(
      `Created anchor scaffold at ${Create.relative(root, anchorPath)}`,
    );
  }

  public static prompt(kind: string): void {
    const root = Create.resolveWorkspaceRoot();
    const promptKind = kind.toLowerCase();
    const files: Record<string, string> = {
      soul: 'SOUL.md',
      agents: 'AGENTS.md',
      user: 'USER.md',
      tools: 'TOOLS.md',
      identity: 'IDENTITY.md',
      memory: 'MEMORY.md',
    };
    const filename = files[promptKind];
    if (!filename) {
      throw new UI.CliError(
        `Unknown prompt kind '${kind}'. Expected one of: ${Object.keys(files).join(', ')}`,
      );
    }

    const promptPath = path.join(root, 'prompts', 'system', filename);
    Create.ensureMissing(promptPath, `Prompt '${filename}' already exists`);
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    fs.writeFileSync(
      promptPath,
      Create.promptBody(promptKind, filename),
      'utf-8',
    );

    UI.printSuccess(
      `Created prompt scaffold at ${Create.relative(root, promptPath)}`,
    );
  }

  public static listKinds(): void {
    console.log(
      [
        picocolors.blue('Available scaffolds:'),
        '  aura create tool <name>',
        '  aura create tool-group <name> [subtools...]',
        '  aura create skill <name>',
        '  aura create garden <name>',
        '  aura create workflow <name>',
        '  aura create persona <name>',
        '  aura create anchor <id>',
        '  aura create prompt <soul|agents|user|tools|identity|memory>',
        '  aura create use-case <name>',
      ].join('\n'),
    );
  }

  private static resolveWorkspaceRoot(): string {
    const resolved = PathResolver.resolveProjectPath(undefined);
    if (!resolved) {
      throw new UI.WorkspaceError('No Aura workspace found.');
    }
    return path.resolve(resolved);
  }

  private static validateName(name: string, label: string): string {
    const normalized = name.trim();
    if (
      normalized.includes('..') ||
      normalized.includes('/') ||
      normalized.includes('\\') ||
      !SCAFFOLD_NAME_PATTERN.test(normalized)
    ) {
      throw new UI.CliError(
        `Invalid ${label} name '${name}'. Use letters, numbers, hyphens, and underscores, starting with a letter or number.`,
      );
    }
    return normalized;
  }

  private static ensureMissing(targetPath: string, message: string): void {
    if (fs.existsSync(targetPath)) {
      throw new UI.CliError(message);
    }
  }

  private static writeJson(targetPath: string, value: unknown): void {
    fs.writeFileSync(
      targetPath,
      `${JSON.stringify(value, null, 2)}\n`,
      'utf-8',
    );
  }

  private static parseAllowPaths(raw?: string): string[] {
    if (!raw || raw.trim().length === 0) return [];
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private static relative(root: string, targetPath: string): string {
    return path.relative(root, targetPath) || '.';
  }

  private static titleize(name: string): string {
    return name
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private static toolLogic(): string {
    return [
      '#!/usr/bin/env python3',
      'import json',
      'import sys',
      '',
      '',
      'def main():',
      '    args = json.loads(sys.stdin.read() or "{}")',
      '    print(json.dumps({',
      '        "status": "ok",',
      '        "args": args,',
      '        "message": "TODO: implement tool logic"',
      '    }))',
      '',
      '',
      'if __name__ == "__main__":',
      '    main()',
      '',
    ].join('\n');
  }

  private static promptBody(kind: string, filename: string): string {
    const headers: Record<string, string> = {
      soul: '# AGENT PERSONA (SOUL)',
      agents: '# OPERATING INSTRUCTIONS',
      user: '# USER CONTEXT',
      tools: '# TOOL GUIDELINES',
      identity: '# AGENT IDENTITY',
      memory: '# LONG-TERM MEMORY',
    };
    return [
      headers[kind] || `# ${filename}`,
      '',
      `TODO: Add workspace-specific ${kind} guidance.`,
      '',
    ].join('\n');
  }

  public static useCase(name: string): void {
    const root = Create.resolveWorkspaceRoot();
    const normalized = name.trim().toLowerCase();
    if (normalized !== 'auto-kaggle') {
      throw new UI.CliError(
        `Unsupported use-case '${name}'. Currently supported: auto-kaggle`,
      );
    }

    fs.mkdirSync(path.join(root, 'params'), { recursive: true });
    fs.mkdirSync(path.join(root, 'garden', 'auto-kaggle'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', 'auto-kaggle'), { recursive: true });
    fs.mkdirSync(path.join(root, 'prompts', 'system'), { recursive: true });
    fs.mkdirSync(path.join(root, 'prompts', 'ralph'), { recursive: true });
    fs.mkdirSync(path.join(root, 'anchors'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tools', 'timer'), { recursive: true });

    fs.writeFileSync(
      path.join(root, 'params', 'autokaggle.yml'),
      [
        'competition:',
        '  slug: "playground-series-s5e1"',
        '  title: "Playground Series S5E1"',
        '  mode: "offline"       # offline | kaggle',
        '  rules_accepted: false',
        '  external_data_allowed: false',
        '',
        'data:',
        '  raw_dir: "data/raw"',
        '  train_file: "data/raw/train.csv"',
        '  test_file: "data/raw/test.csv"',
        '  sample_submission_file: "data/raw/sample_submission.csv"',
        '  id_column: "id"',
        '  target_column: ""',
        '',
        'metric:',
        '  name: ""',
        '  higher_is_better: true',
        '  local_validation_required: true',
        '',
        'validation:',
        '  fold_file: "data/processed/folds.csv"',
        '  frozen: false',
        '  n_splits: 5',
        '  random_seed: 42',
        '  min_cv_delta_to_submit: 0.0001',
        '',
        'submission:',
        '  allow_submit: false',
        '  auto_wait: true',
        '  auto_poll_leaderboard: true',
        '  daily_budget: 3',
        '  cooldown_minutes: 30',
        '  max_wait_chunk_seconds: 900',
        '  message_prefix: "autokaggle"',
        '  require_ralph_verifier: true',
        '  verifier_command: "python src/verify_submission.py --submission {submission_path} --run-id {run_id}"',
        '',
        'loop:',
        '  max_rounds: 50',
        '  max_real_submissions: 20',
        '  stop_when_no_cv_improvement_rounds: 8',
        '  target_public_score: null',
        '  sleep_after_failed_poll_seconds: 120',
        '',
        'paths:',
        '  registry_db: "experiments/runs.sqlite"',
        '  submissions_dir: "submissions"',
        '  reports_dir: "reports"',
        '  artifacts_dir: "experiments/artifacts"',
      ].join('\n'),
      'utf-8',
    );

    fs.writeFileSync(
      path.join(root, 'garden', 'auto-kaggle', 'garden.md'),
      [
        '---',
        'name: auto-kaggle',
        'description: Garden playbook for AutoKaggle competition.',
        'requires: [timer, anchor_submit]',
        '---',
        '',
        '# AutoKaggle Garden',
        '',
        '## Role',
        'This Garden assembles the AutoKaggle project context. Define stages, anchors, and required tools.',
      ].join('\n'),
      'utf-8',
    );

    fs.writeFileSync(
      path.join(root, 'skills', 'auto-kaggle', 'SKILL.md'),
      [
        '---',
        'name: auto-kaggle',
        'description: Procedure for autonomous Kaggle iteration.',
        'requires: [timer]',
        '---',
        '',
        '# AutoKaggle Skill',
        '',
        '- Always read `params/autokaggle.yml` first.',
        '- Before submit, verify format using verifier_command.',
      ].join('\n'),
      'utf-8',
    );

    fs.writeFileSync(
      path.join(root, 'prompts', 'system', 'SOUL.md'),
      [
        '# AGENT PERSONA (SOUL)',
        '',
        'You are AutoKaggle Operator, a disciplined Kaggle automation agent.',
      ].join('\n'),
      'utf-8',
    );

    fs.writeFileSync(
      path.join(root, 'prompts', 'system', 'TOOLS.md'),
      [
        '# TOOL GUIDELINES',
        '',
        '- Use required tools for deterministic project actions.',
      ].join('\n'),
      'utf-8',
    );

    fs.writeFileSync(
      path.join(root, 'prompts', 'ralph', 'ralph_system.md'),
      [
        '# Ralph Developer Rules',
        '',
        '- Make the smallest change that can pass the verifier.',
      ].join('\n'),
      'utf-8',
    );

    fs.writeFileSync(
      path.join(root, 'prompts', 'ralph', 'critic_rules.md'),
      [
        '# Ralph Critic Rules',
        '',
        '- Return completed=true only if all tests pass.',
      ].join('\n'),
      'utf-8',
    );

    fs.writeFileSync(
      path.join(root, 'anchors', '00_ready.json'),
      JSON.stringify(
        { id: '00_ready', description: 'Workspace ready' },
        null,
        2,
      ),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(root, 'anchors', '10_validation_frozen.json'),
      JSON.stringify(
        { id: '10_validation_frozen', description: 'Validation frozen' },
        null,
        2,
      ),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(root, 'anchors', '20_submission_loop_started.json'),
      JSON.stringify(
        {
          id: '20_submission_loop_started',
          description: 'Submission loop started',
        },
        null,
        2,
      ),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(root, 'anchors', '30_feedback_recorded.json'),
      JSON.stringify(
        {
          id: '30_feedback_recorded',
          description: 'Leaderboard feedback recorded',
        },
        null,
        2,
      ),
      'utf-8',
    );

    fs.writeFileSync(
      path.join(root, 'workflow.yml'),
      [
        'version: 1',
        'name: auto-kaggle',
        'description: Autonomous Kaggle competition workflow.',
        '',
        'params:',
        '  path: params/autokaggle.yml',
        '',
        'context:',
        '  garden: garden/auto-kaggle/garden.md',
        '  skill: skills/auto-kaggle/SKILL.md',
        '  prompts:',
        '    - prompts/system/SOUL.md',
        '    - prompts/system/TOOLS.md',
        '    - prompts/ralph/ralph_system.md',
        '    - prompts/ralph/critic_rules.md',
        '',
        'tools:',
        '  required:',
        '    - timer',
        '',
        'stages:',
        '  - id: ready',
        '    title: Workspace ready',
        '    anchor: anchors/00_ready.json',
        '    assert_files:',
        '      - data/raw/train.csv',
        '      - data/raw/test.csv',
        '      - data/raw/sample_submission.csv',
        '  - id: validation_frozen',
        '    title: Validation frozen',
        '    anchor: anchors/10_validation_frozen.json',
        '    requires:',
        '      - ready',
        '  - id: submission_loop',
        '    title: Submission loop started',
        '    anchor: anchors/20_submission_loop_started.json',
        '    requires:',
        '      - validation_frozen',
        '  - id: feedback_recorded',
        '    title: Feedback recorded',
        '    anchor: anchors/30_feedback_recorded.json',
        '    requires:',
        '      - submission_loop',
        '',
        'run:',
        '  mode: classic',
        '  max_steps: 80',
        '  goal: |',
        '    Run AutoKaggle autonomously.',
        '    Read params/autokaggle.yml before acting.',
        '    Stop when the configured stop condition is met.',
      ].join('\n'),
      'utf-8',
    );

    fs.writeFileSync(
      path.join(root, 'tools', 'timer', 'manifest.json'),
      JSON.stringify(
        {
          name: 'timer',
          description: 'Pause/sleep for a given number of seconds.',
          runtime: 'python3',
          entry: 'logic.py',
          input_schema: {
            type: 'object',
            properties: {
              seconds: { type: 'number' },
            },
            required: ['seconds'],
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    fs.writeFileSync(
      path.join(root, 'tools', 'timer', 'logic.py'),
      [
        '#!/usr/bin/env python3',
        'import json',
        'import sys',
        'import time',
        '',
        'def main():',
        '    args = json.loads(sys.stdin.read() or "{}")',
        '    sec = args.get("seconds", 1.0)',
        '    time.sleep(sec)',
        '    print(json.dumps({"status": "ok", "slept_seconds": sec}))',
        '',
        'if __name__ == "__main__":',
        '    main()',
      ].join('\n'),
      'utf-8',
    );

    UI.printSuccess(
      `Successfully initialized '${name}' use-case in your workspace!`,
    );
  }
}

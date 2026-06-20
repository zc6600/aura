import path from 'node:path';
import fs from 'node:fs';
import picocolors from 'picocolors';
import { loadWorkflow } from '../../core/workflow/manifest.js';
import {
  compileWorkflowGoal,
  getWorkflowStatus,
  smokeWorkflow,
  type WorkflowCheck,
} from '../../core/workflow/runner.js';
import * as PathResolver from '../../utils/pathResolver.js';
import * as UI from '../ui.js';
import { Kernel } from './kernel.js';

export class Workflow {
  public static init(
    name: string,
    options: {
      projectPath?: string;
      withParams?: boolean;
      withAnchors?: boolean;
      withPrompts?: boolean;
    } = {},
  ): void {
    const root = Workflow.resolveRoot(options.projectPath);
    const normalized = Workflow.validateName(name);
    const workflowPath = path.join(root, 'workflow.yml');
    if (fs.existsSync(workflowPath)) {
      throw new UI.CliError('workflow.yml already exists');
    }

    if (options.withParams) {
      const paramsPath = path.join(root, 'params', `${normalized}.yml`);
      fs.mkdirSync(path.dirname(paramsPath), { recursive: true });
      fs.writeFileSync(paramsPath, 'mode: dry\n', 'utf-8');
    }
    if (options.withPrompts) {
      const systemDir = path.join(root, 'prompts', 'system');
      fs.mkdirSync(systemDir, { recursive: true });
      Workflow.writeIfMissing(path.join(systemDir, 'SOUL.md'), '# AGENT PERSONA\n');
      Workflow.writeIfMissing(path.join(systemDir, 'TOOLS.md'), '# TOOL GUIDELINES\n');
    }
    if (options.withAnchors) {
      const anchorPath = path.join(root, 'anchors', '00_ready.json');
      fs.mkdirSync(path.dirname(anchorPath), { recursive: true });
      Workflow.writeIfMissing(
        anchorPath,
        `${JSON.stringify({ id: '00_ready', call_when: ['Workspace ready'] }, null, 2)}\n`,
      );
    }

    fs.writeFileSync(
      workflowPath,
      [
        'version: 1',
        `name: ${normalized}`,
        `description: "TODO: Describe the ${normalized} workflow."`,
        ...(options.withParams
          ? ['', 'params:', `  path: params/${normalized}.yml`]
          : []),
        ...(options.withPrompts
          ? [
              '',
              'context:',
              '  prompts:',
              '    - prompts/system/SOUL.md',
              '    - prompts/system/TOOLS.md',
            ]
          : []),
        'tools:',
        '  required: []',
        ...(options.withAnchors
          ? ['', 'stages:', '  - id: ready', '    anchor: anchors/00_ready.json']
          : []),
        '',
        'run:',
        '  mode: classic',
        '  max_steps: 20',
        '  goal: |',
        `    Run the ${normalized} workflow.`,
        '',
      ].join('\n'),
      'utf-8',
    );
    UI.printSuccess(`Initialized workflow '${normalized}' at workflow.yml`);
  }

  public static async run(
    name?: string,
    projectPath?: string,
    options: { maxSteps?: number } = {},
  ): Promise<void> {
    await Kernel.workflow(projectPath, {
      name,
      maxSteps: options.maxSteps,
      human: true,
    });
  }

  public static status(name?: string, projectPath?: string): void {
    const root = Workflow.resolveRoot(projectPath);
    const loaded = Workflow.load(root, name);
    const status = getWorkflowStatus(loaded);

    console.log(picocolors.blue('=== Aura Workflow Status ==='));
    console.log(`Workflow: ${loaded.manifest.name}`);
    if (loaded.manifest.description) {
      console.log(`Description: ${loaded.manifest.description}`);
    }
    console.log(`Path: ${path.relative(root, loaded.path) || 'workflow.yml'}`);
    console.log(`Workspace: ${root}\n`);

    if (status.params) {
      console.log(picocolors.yellow('[Params]'));
      console.log(
        `  ${status.params.path}: ${status.params.exists ? picocolors.green('ok') : picocolors.red('missing')}`,
      );
      if (status.params.schema) {
        console.log(
          `  ${status.params.schema}: ${status.params.schemaExists ? picocolors.green('ok') : picocolors.red('missing')}`,
        );
      }
      console.log();
    }

    console.log(picocolors.yellow('[Stages]'));
    if (status.stages.length === 0) {
      console.log('  No stages declared.');
    } else {
      for (const stage of status.stages) {
        const title = stage.title ? ` - ${stage.title}` : '';
        const marker = stage.completed
          ? picocolors.green('done')
          : picocolors.yellow('pending');
        const anchor = stage.anchor ? ` (${stage.anchor})` : '';
        console.log(`  ${stage.id}${title}: ${marker}${anchor}`);
        if (stage.problems && stage.problems.length > 0) {
          for (const problem of stage.problems) {
            console.log(picocolors.red(`    ✗ Requirement error: ${problem}`));
          }
        }
      }
    }
    console.log();

    console.log(picocolors.yellow('[Checks]'));
    Workflow.printChecks(status.checks, '  ');
  }

  public static explain(
    name?: string,
    projectPath?: string,
    options: { json?: boolean } = {},
  ): void {
    const root = Workflow.resolveRoot(projectPath);
    const loaded = Workflow.load(root, name);
    const manifest = loaded.manifest;
    const payload = {
      workflow: manifest.name,
      path: path.relative(root, loaded.path) || 'workflow.yml',
      params: manifest.params,
      context: manifest.context || {},
      tools: manifest.tools?.required || [],
      stages: manifest.stages || [],
      compiled_goal: compileWorkflowGoal(loaded),
    };
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(picocolors.blue('=== Aura Workflow Explain ==='));
    console.log(`Workflow: ${payload.workflow}`);
    console.log(`Path: ${payload.path}`);
    console.log(`Tools: ${payload.tools.join(', ') || '(none)'}`);
    console.log(`Stages: ${payload.stages.map((s) => s.id).join(', ') || '(none)'}`);
    console.log('\n[Compiled Goal]');
    console.log(payload.compiled_goal);
  }

  public static doctor(name?: string, projectPath?: string): void {
    const root = Workflow.resolveRoot(projectPath);
    const loaded = Workflow.load(root, name);
    const status = getWorkflowStatus(loaded);
    console.log(picocolors.blue('=== Aura Workflow Doctor ==='));
    Workflow.printChecks(status.checks);
    const failed = status.checks.filter((c) => !c.ok);
    if (failed.length > 0) {
      throw new UI.CliError(
        `${failed.length} workflow check(s) failed for '${loaded.manifest.name}'.`,
      );
    }
    UI.printSuccess(`Workflow '${loaded.manifest.name}' is ready.`);
  }

  public static smoke(
    name?: string,
    projectPath?: string,
    options: { json?: boolean } = {},
  ): void {
    const root = Workflow.resolveRoot(projectPath);
    const loaded = Workflow.load(root, name);
    const checks = smokeWorkflow(loaded);
    const failed = checks.filter((c) => !c.ok);
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            workflow: loaded.manifest.name,
            checks,
            failed: failed.length,
          },
          null,
          2,
        ),
      );
      if (failed.length > 0) {
        throw new UI.CliError(
          `${failed.length} workflow smoke check(s) failed for '${loaded.manifest.name}'.`,
        );
      }
      return;
    }
    console.log(picocolors.blue('=== Aura Workflow Smoke ==='));
    Workflow.printChecks(checks);
    if (failed.length > 0) {
      throw new UI.CliError(
        `${failed.length} workflow smoke check(s) failed for '${loaded.manifest.name}'.`,
      );
    }
    UI.printSuccess(`Workflow '${loaded.manifest.name}' smoke checks passed.`);
  }

  public static graph(
    name?: string,
    projectPath?: string,
    options: { mermaid?: boolean } = {},
  ): void {
    const root = Workflow.resolveRoot(projectPath);
    const loaded = Workflow.load(root, name);
    const stages = loaded.manifest.stages || [];
    if (options.mermaid) {
      console.log('graph TD');
      for (const stage of stages) {
        console.log(`  ${stage.id}[${stage.title || stage.id}]`);
        for (const req of stage.requires || []) {
          console.log(`  ${req} --> ${stage.id}`);
        }
      }
      return;
    }
    console.log(picocolors.blue('=== Aura Workflow Graph ==='));
    if (stages.length === 0) {
      console.log('No stages declared.');
      return;
    }
    for (const stage of stages) {
      const deps = stage.requires?.length ? ` requires: ${stage.requires.join(', ')}` : '';
      console.log(`${stage.id}${stage.title ? ` (${stage.title})` : ''}${deps}`);
    }
  }

  private static resolveRoot(projectPath?: string): string {
    try {
      return path.resolve(
        PathResolver.resolveProjectPath(projectPath || undefined) ||
          projectPath ||
          process.cwd(),
      );
    } catch {
      return path.resolve(projectPath || process.cwd());
    }
  }

  private static load(root: string, name?: string) {
    try {
      return loadWorkflow(root, name);
    } catch (e: unknown) {
      throw new UI.CliError((e as Error).message);
    }
  }

  private static printChecks(checks: WorkflowCheck[], prefix = ''): void {
    for (const check of checks) {
      const mark = check.ok ? picocolors.green('✓') : picocolors.red('✗');
      const detail = check.detail ? picocolors.gray(` (${check.detail})`) : '';
      console.log(`${prefix}${mark} ${check.label}${detail}`);
    }
  }

  private static validateName(name: string): string {
    const normalized = name.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(normalized)) {
      throw new UI.CliError(
        `Invalid workflow name '${name}'. Use letters, numbers, hyphens, and underscores.`,
      );
    }
    return normalized;
  }

  private static writeIfMissing(target: string, content: string): void {
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, content, 'utf-8');
    }
  }
}

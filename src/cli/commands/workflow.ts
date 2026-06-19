import path from 'node:path';
import picocolors from 'picocolors';
import { loadWorkflow } from '../../core/workflow/manifest.js';
import {
  getWorkflowStatus,
  type WorkflowCheck,
} from '../../core/workflow/runner.js';
import * as PathResolver from '../../utils/pathResolver.js';
import * as UI from '../ui.js';
import { Kernel } from './kernel.js';

export class Workflow {
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
}

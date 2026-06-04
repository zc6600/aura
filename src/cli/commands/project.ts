import fs from 'node:fs';
import path from 'node:path';
import picocolors from 'picocolors';
import yaml from 'yaml';
import * as ProjectRegistry from '../../utils/projectRegistry.js';
import * as PathResolver from '../../utils/pathResolver.js';
import * as UI from '../ui.js';

export class Project {
  public static list(): void {
    const projects = ProjectRegistry.registeredProjects();
    const keys = Object.keys(projects);

    if (keys.length === 0) {
      console.log("No Aura projects registered yet. Run 'aura new <project_name>' to register a workspace.");
      return;
    }

    console.log("Registered Aura Projects:");
    console.log("-".repeat(80));
    console.log(this.padRight("Name", 20) + this.padRight("Path", 45) + "Status");
    console.log("-".repeat(80));

    for (const name of keys) {
      const p = projects[name];
      const hasAura = fs.existsSync(path.join(p, '.aura'));
      const status = hasAura ? picocolors.green('Active') : picocolors.red('Missing (.aura folder not found)');
      console.log(this.padRight(name, 20) + this.padRight(p, 45) + status);
    }
    console.log("-".repeat(80));
  }

  public static async delete(projectName: string): Promise<void> {
    const projects = ProjectRegistry.registeredProjects();
    const pPath = projects[projectName];

    if (!pPath) {
      console.error(picocolors.red(`⛔️ Error: Project '${projectName}' is not registered globally.`));
      process.exit(1);
    }

    console.log(`⚠️ WARNING: You are about to delete project '${projectName}'.`);
    console.log(`   - Registered Path: ${pPath}`);

    const hidden = path.join(pPath, '.aura');
    const physicalExists = fs.existsSync(hidden) && fs.statSync(hidden).isDirectory();

    if (physicalExists) {
      console.log('   - Local environment (.aura/) will be physically deleted.');
    } else {
      console.log('   - Local environment (.aura/) does not exist physically (already deleted or moved).');
    }

    const answer = await UI.confirm('❓ Are you sure you want to proceed?');
    if (answer) {
      if (physicalExists) {
        try {
          fs.rmSync(hidden, { recursive: true, force: true });
          console.log(picocolors.green(`Successfully deleted physical sandbox at ${hidden}.`));
        } catch (e: any) {
          console.error(picocolors.red(`Failed to delete physical sandbox: ${e.message}`));
        }
      }

      if (ProjectRegistry.unregister(projectName)) {
        console.log(picocolors.green(`Project '${projectName}' has been successfully unregistered globally.`));
      } else {
        console.error(picocolors.red(`Failed to unregister project '${projectName}' from global projects registry.`));
      }
    } else {
      console.log('Deletion cancelled.');
    }
  }

  public static register(projectName: string): void {
    let auraDir: string | null = null;
    try {
      auraDir = PathResolver.ensureWorkspace(process.cwd());
    } catch {
      console.error(picocolors.red('⛔️ Error: Not in an Aura workspace.'));
      process.exit(1);
    }

    const workspaceRoot = path.dirname(auraDir);

    // Register globally
    ProjectRegistry.register(projectName, workspaceRoot);

    // Write local config name
    const cfgPath = PathResolver.resolveConfigPath(auraDir);
    try {
      let cfg: any = {};
      if (fs.existsSync(cfgPath)) {
        cfg = yaml.parse(fs.readFileSync(cfgPath, 'utf-8')) || {};
      }
      cfg.project_name = projectName;
      fs.writeFileSync(cfgPath, yaml.stringify(cfg), 'utf-8');
    } catch {}

    console.log(picocolors.green(`Successfully registered workspace at ${workspaceRoot} as '${projectName}'!`));
  }

  public static prune(): void {
    const projects = ProjectRegistry.registeredProjects();
    const keys = Object.keys(projects);

    if (keys.length === 0) {
      console.log('No projects registered.');
      return;
    }

    let prunedCount = 0;
    for (const name of keys) {
      const pPath = projects[name];
      if (!fs.existsSync(path.join(pPath, '.aura'))) {
        ProjectRegistry.unregister(name);
        console.log(picocolors.yellow(`Pruned missing project '${name}' (path: ${pPath})`));
        prunedCount++;
      }
    }

    if (prunedCount > 0) {
      console.log(picocolors.green(`Successfully pruned ${prunedCount} missing project(s)!`));
    } else {
      console.log('No missing projects to prune.');
    }
  }

  private static padRight(str: string, len: number): string {
    if (str.length >= len) {
      return str.substring(0, len - 3) + '...';
    }
    return str + ' '.repeat(len - str.length);
  }
}

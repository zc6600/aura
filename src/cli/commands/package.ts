import fs from 'node:fs';
import path from 'node:path';
import picocolors from 'picocolors';
import * as PathResolver from '../../utils/pathResolver.js';
import * as UI from '../ui.js';

export class PackageCommand {
  public static install(
    sourcePath: string,
    options: { to?: string; dryRun?: boolean; force?: boolean } = {},
  ): void {
    const src = path.resolve(sourcePath);
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
      throw new UI.CliError(`Package path is not a directory: ${sourcePath}`);
    }

    const target =
      PathResolver.resolveProjectPath(options.to || undefined) ||
      path.resolve(options.to || process.cwd());
    if (!fs.existsSync(path.join(target, '.aura-workspace'))) {
      throw new UI.CliError(
        `${target} is not an Aura workspace. Run 'aura new ${target}' first.`,
      );
    }

    const roots = PackageCommand.copyRoots(src);
    if (roots.length === 0) {
      throw new UI.CliError(
        'Package has no installable content. Expected template/ or tools/.',
      );
    }

    const actions: string[] = [];
    for (const root of roots) {
      const from = path.join(src, root.source);
      const to = path.join(target, root.dest);
      actions.push(...PackageCommand.copyTree(from, to, options));
    }

    if (options.dryRun) {
      console.log(picocolors.blue('=== Aura Package Install Plan ==='));
      actions.forEach((a) => console.log(a));
      return;
    }

    UI.printSuccess(`Installed package from ${src} into ${target}`);
  }

  private static copyRoots(src: string): Array<{ source: string; dest: string }> {
    const roots: Array<{ source: string; dest: string }> = [];
    if (fs.existsSync(path.join(src, 'template'))) {
      roots.push({ source: 'template', dest: '.' });
    }
    if (fs.existsSync(path.join(src, 'tools'))) {
      roots.push({ source: 'tools', dest: 'tools' });
    }
    return roots;
  }

  private static copyTree(
    fromRoot: string,
    toRoot: string,
    options: { dryRun?: boolean; force?: boolean },
  ): string[] {
    const actions: string[] = [];
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        if (name === '.git' || name === '__pycache__' || name.endsWith('.pyc')) {
          continue;
        }
        const src = path.join(dir, name);
        const rel = path.relative(fromRoot, src);
        const dest = path.join(toRoot, rel);
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
          walk(src);
          continue;
        }
        if (fs.existsSync(dest) && !options.force) {
          actions.push(`skip ${dest}`);
          continue;
        }
        actions.push(`${options.force && fs.existsSync(dest) ? 'overwrite' : 'write'} ${dest}`);
        if (!options.dryRun) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
        }
      }
    };
    walk(fromRoot);
    return actions;
  }
}

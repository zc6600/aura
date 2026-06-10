import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fg from 'fast-glob';
import picocolors from 'picocolors';
import * as ConfigManager from '../../utils/configManager.js';
import type { AuraConfig } from '../../utils/configSchema.js';
import * as PathResolver from '../../utils/pathResolver.js';
import * as UI from '../ui.js';

interface Injectable {
  type: string;
  path: string;
  status: string;
  reason: string | null;
}

export class Hints {
  public static async list(projectPath?: string): Promise<void> {
    let resolvedPath = '';
    try {
      resolvedPath =
        PathResolver.resolveProjectPath(projectPath || undefined) ||
        process.cwd();
    } catch {
      resolvedPath = process.cwd();
    }

    const auraDir = PathResolver.findAuraDir(resolvedPath);
    const cfgPath = auraDir ? PathResolver.resolveConfigPath(auraDir) : null;
    let cfg: AuraConfig = {};
    if (cfgPath && fs.existsSync(cfgPath)) {
      try {
        cfg = ConfigManager.loadTyped(auraDir || resolvedPath);
      } catch (e: any) {
        console.warn(
          picocolors.yellow(
            `⚠️ Warning: Failed to load configuration: ${e.message}`,
          ),
        );
      }
    }

    const autoInjectReadme = cfg.hints?.auto_inject_readme !== false;
    const ignoreList: string[] = cfg.hints?.ignore_list || [];

    const injectables: Injectable[] = [];

    // 1. AURA_README.md
    const readmePath = path.join(resolvedPath, 'AURA_README.md');
    if (fs.existsSync(readmePath)) {
      const ignored =
        !autoInjectReadme || ignoreList.includes('AURA_README.md');
      const reason = !autoInjectReadme
        ? 'auto_inject_readme: false'
        : ignoreList.includes('AURA_README.md')
          ? 'in ignore_list'
          : null;
      injectables.push({
        type: 'Global Rules',
        path: 'AURA_README.md',
        status: ignored ? 'IGNORED' : 'INJECTED',
        reason,
      });
    }

    // 2. .hint files
    const hintDirs = [
      path.join(resolvedPath, 'knowledge'),
      path.join(resolvedPath, 'tools'),
    ];
    for (const dir of hintDirs) {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      Hints.globFiles(dir, '.hint').forEach((file) => {
        const rel = path.relative(resolvedPath, file);
        const ignored = ignoreList.some(
          (pat) => Hints.fnmatch(pat, rel) || rel === pat || rel.includes(pat),
        );
        injectables.push({
          type: '.hint File',
          path: rel,
          status: ignored ? 'IGNORED' : 'INJECTED',
          reason: ignored ? 'in ignore_list' : null,
        });
      });
    }

    // 3. Magic @aura-hint files
    const wsFiles = await Hints.globAllWorkspaceFiles(resolvedPath);
    for (const file of wsFiles) {
      const rel = path.relative(resolvedPath, file);
      if (Hints.hasMagicHint(file)) {
        const ignored = ignoreList.some(
          (pat) => Hints.fnmatch(pat, rel) || rel === pat || rel.includes(pat),
        );
        injectables.push({
          type: 'Magic Hint (@aura-hint)',
          path: rel,
          status: ignored ? 'IGNORED' : 'INJECTED',
          reason: ignored ? 'in ignore_list' : null,
        });
      }
    }

    if (injectables.length === 0) {
      console.log(`No files found for hint injection in ${resolvedPath}.`);
      return;
    }

    console.log('\n=== Hint & Guidance Injection Files ===');
    console.log(
      Hints.padRight('TYPE', 28) +
        Hints.padRight('FILE PATH', 50) +
        Hints.padRight('STATUS', 12) +
        'REASON',
    );
    console.log('-'.repeat(110));

    for (const item of injectables) {
      const statusColor =
        item.status === 'INJECTED'
          ? picocolors.green('INJECTED')
          : picocolors.yellow('IGNORED');
      const reasonStr = item.reason ? `(${picocolors.red(item.reason)})` : '';
      console.log(
        Hints.padRight(item.type, 28) +
          Hints.padRight(item.path, 50) +
          Hints.padRight(statusColor, 20) + // padding with colors requires a bit more length
          reasonStr,
      );
    }
    console.log('-'.repeat(110));
    console.log(
      "\n💡 Use 'aura hints toggle <FILE_PATH>' to manually enable/disable injection for a file.",
    );
  }

  public static toggle(filePath: string, projectPath?: string): void {
    let resolvedPath = '';
    try {
      resolvedPath =
        PathResolver.resolveProjectPath(projectPath || undefined) ||
        process.cwd();
    } catch {
      resolvedPath = process.cwd();
    }

    const auraDir = PathResolver.findAuraDir(resolvedPath);
    if (!auraDir) {
      throw new UI.WorkspaceError('Not in an Aura workspace.');
    }

    const cfgPath = PathResolver.resolveConfigPath(auraDir);
    if (!cfgPath) {
      throw new UI.WorkspaceError('Failed to resolve configuration path.');
    }
    let cfg: AuraConfig = {};
    if (fs.existsSync(cfgPath)) {
      try {
        cfg = ConfigManager.load(auraDir) || {};
      } catch (e: any) {
        console.warn(
          picocolors.yellow(
            `⚠️ Warning: Failed to load configuration: ${e.message}`,
          ),
        );
      }
    }

    cfg.hints = cfg.hints || {};
    cfg.hints.ignore_list = cfg.hints.ignore_list || [];

    if (filePath === 'AURA_README.md') {
      const current = cfg.hints.auto_inject_readme !== false;
      const newState = !current;
      cfg.hints.auto_inject_readme = newState;
      ConfigManager.write(cfgPath, cfg);
      const statusMsg = newState
        ? picocolors.green('ENABLED')
        : picocolors.yellow('DISABLED');
      console.log(
        `Toggled AURA_README.md injection. Now: ${statusMsg} (via auto_inject_readme)`,
      );
      return;
    }

    const list: string[] = cfg.hints.ignore_list;
    const index = list.indexOf(filePath);
    if (index !== -1) {
      list.splice(index, 1);
      ConfigManager.write(cfgPath, cfg);
      console.log(
        `Removed '${filePath}' from ignore_list. Injection is now ${picocolors.green('ENABLED')}.`,
      );
    } else {
      list.push(filePath);
      ConfigManager.write(cfgPath, cfg);
      console.log(
        `Added '${filePath}' to ignore_list. Injection is now ${picocolors.yellow('IGNORED')}.`,
      );
    }
  }

  public static global(): void {
    const globalHintFile = path.join(os.homedir(), '.aura', 'global_hint.md');
    console.log('\n=== Global Operational Guidance & User Preferences ===');
    console.log(`File Path: ${globalHintFile.replace(os.homedir(), '~')}`);
    console.log('-'.repeat(60));

    if (fs.existsSync(globalHintFile)) {
      const content = fs.readFileSync(globalHintFile, 'utf-8').trim();
      if (content.length === 0) {
        console.log('(File is empty)');
      } else {
        console.log(content);
      }
    } else {
      console.log(picocolors.yellow('(File does not exist yet)'));
      console.log('\n💡 To create it, run:');
      console.log('   mkdir -p ~/.aura && touch ~/.aura/global_hint.md');
      console.log(
        '   Then edit the file with your preferences, global instructions, or target models/rules.',
      );
    }
    console.log('-'.repeat(60));
  }

  private static globFiles(dir: string, ext: string): string[] {
    try {
      return fg.sync(`**/*${ext}`, {
        cwd: dir,
        ignore: ['**/node_modules/**', '**/.git/**', '**/.aura/**'],
        absolute: true,
      });
    } catch {
      return [];
    }
  }

  private static async globAllWorkspaceFiles(dir: string): Promise<string[]> {
    try {
      // fast-glob is async and non-blocking, significantly faster on large projects
      return await fg(
        ['**/*.py', '**/*.rb', '**/*.sh', '**/*.md', '**/*.txt'],
        {
          cwd: dir,
          ignore: [
            'node_modules/**',
            '.git/**',
            '.aura/**',
            'state/**',
            'dist/**',
            'build/**',
          ],
          absolute: true,
          followSymbolicLinks: false,
          // Exclude files larger than 100KB
          stats: false,
        },
      );
    } catch {
      return [];
    }
  }

  private static hasMagicHint(file: string): boolean {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n').slice(0, 15);
      return lines.some((line) => line.includes('@aura-hint:'));
    } catch {
      return false;
    }
  }

  private static fnmatch(pattern: string, file: string): boolean {
    // Simple wildcard translation
    const regexStr =
      '^' +
      pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') +
      '$';
    try {
      const regex = new RegExp(regexStr);
      return regex.test(file);
    } catch {
      return false;
    }
  }

  private static padRight(str: string, len: number): string {
    const cleanStr = str.replace(/\x1b\[\d+m/g, ''); // strip ansi for calculation
    if (cleanStr.length >= len) {
      return str;
    }
    return str + ' '.repeat(len - cleanStr.length);
  }
}

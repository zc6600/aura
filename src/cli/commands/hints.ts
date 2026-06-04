import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import picocolors from 'picocolors';
import yaml from 'yaml';
import * as PathResolver from '../../utils/pathResolver.js';

interface Injectable {
  type: string;
  path: string;
  status: string;
  reason: string | null;
}

export class Hints {
  public static list(projectPath?: string): void {
    let resolvedPath = '';
    try {
      resolvedPath = PathResolver.resolveProjectPath(projectPath || undefined) || process.cwd();
    } catch {
      resolvedPath = process.cwd();
    }

    const auraDir = PathResolver.findAuraDir(resolvedPath);
    const cfgPath = auraDir ? PathResolver.resolveConfigPath(auraDir) : null;
    let cfg: any = {};
    if (cfgPath && fs.existsSync(cfgPath)) {
      try {
        cfg = yaml.parse(fs.readFileSync(cfgPath, 'utf-8')) || {};
      } catch {}
    }

    const autoInjectReadme = cfg.hints?.auto_inject_readme !== false;
    const ignoreList: string[] = cfg.hints?.ignore_list || [];

    const injectables: Injectable[] = [];

    // 1. AURA_README.md
    const readmePath = path.join(resolvedPath, 'AURA_README.md');
    if (fs.existsSync(readmePath)) {
      const ignored = !autoInjectReadme || ignoreList.includes('AURA_README.md');
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
    const hintDirs = [path.join(resolvedPath, 'knowledge'), path.join(resolvedPath, 'tools')];
    for (const dir of hintDirs) {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      this.globFiles(dir, '.hint').forEach((file) => {
        const rel = path.relative(resolvedPath, file);
        const ignored = ignoreList.some((pat) => this.fnmatch(pat, rel) || rel === pat || rel.includes(pat));
        injectables.push({
          type: '.hint File',
          path: rel,
          status: ignored ? 'IGNORED' : 'INJECTED',
          reason: ignored ? 'in ignore_list' : null,
        });
      });
    }

    // 3. Magic @aura-hint files
    this.globAllWorkspaceFiles(resolvedPath).forEach((file) => {
      const rel = path.relative(resolvedPath, file);
      if (this.hasMagicHint(file)) {
        const ignored = ignoreList.some((pat) => this.fnmatch(pat, rel) || rel === pat || rel.includes(pat));
        injectables.push({
          type: 'Magic Hint (@aura-hint)',
          path: rel,
          status: ignored ? 'IGNORED' : 'INJECTED',
          reason: ignored ? 'in ignore_list' : null,
        });
      }
    });

    if (injectables.length === 0) {
      console.log(`No files found for hint injection in ${resolvedPath}.`);
      return;
    }

    console.log('\n=== Hint & Guidance Injection Files ===');
    console.log(
      this.padRight('TYPE', 28) +
      this.padRight('FILE PATH', 50) +
      this.padRight('STATUS', 12) +
      'REASON'
    );
    console.log('-'.repeat(110));

    for (const item of injectables) {
      const statusColor = item.status === 'INJECTED' ? picocolors.green('INJECTED') : picocolors.yellow('IGNORED');
      const reasonStr = item.reason ? `(${picocolors.red(item.reason)})` : '';
      console.log(
        this.padRight(item.type, 28) +
        this.padRight(item.path, 50) +
        this.padRight(statusColor, 20) + // padding with colors requires a bit more length
        reasonStr
      );
    }
    console.log('-'.repeat(110));
    console.log("\n💡 Use 'aura hints toggle <FILE_PATH>' to manually enable/disable injection for a file.");
  }

  public static toggle(filePath: string, projectPath?: string): void {
    let resolvedPath = '';
    try {
      resolvedPath = PathResolver.resolveProjectPath(projectPath || undefined) || process.cwd();
    } catch {
      resolvedPath = process.cwd();
    }

    const auraDir = PathResolver.findAuraDir(resolvedPath);
    if (!auraDir) {
      console.error(picocolors.red('⛔️ Error: Not in an Aura workspace.'));
      process.exit(1);
    }

    const cfgPath = PathResolver.resolveConfigPath(auraDir);
    let cfg: any = {};
    if (fs.existsSync(cfgPath)) {
      try {
        cfg = yaml.parse(fs.readFileSync(cfgPath, 'utf-8')) || {};
      } catch {}
    }

    cfg.hints = cfg.hints || {};
    cfg.hints.ignore_list = cfg.hints.ignore_list || [];

    if (filePath === 'AURA_README.md') {
      const current = cfg.hints.auto_inject_readme !== false;
      const newState = !current;
      cfg.hints.auto_inject_readme = newState;
      fs.writeFileSync(cfgPath, yaml.stringify(cfg), 'utf-8');
      const statusMsg = newState ? picocolors.green('ENABLED') : picocolors.yellow('DISABLED');
      console.log(`Toggled AURA_README.md injection. Now: ${statusMsg} (via auto_inject_readme)`);
      return;
    }

    const list: string[] = cfg.hints.ignore_list;
    const index = list.indexOf(filePath);
    if (index !== -1) {
      list.splice(index, 1);
      fs.writeFileSync(cfgPath, yaml.stringify(cfg), 'utf-8');
      console.log(`Removed '${filePath}' from ignore_list. Injection is now ${picocolors.green('ENABLED')}.`);
    } else {
      list.push(filePath);
      fs.writeFileSync(cfgPath, yaml.stringify(cfg), 'utf-8');
      console.log(`Added '${filePath}' to ignore_list. Injection is now ${picocolors.yellow('IGNORED')}.`);
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
      console.log('   Then edit the file with your preferences, global instructions, or target models/rules.');
    }
    console.log('-'.repeat(60));
  }

  private static globFiles(dir: string, ext: string): string[] {
    const results: string[] = [];
    const walk = (d: string) => {
      const files = fs.readdirSync(d);
      for (const f of files) {
        if (f === 'node_modules' || f === '.git' || f === '.aura') continue;
        const full = path.join(d, f);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (f.endsWith(ext)) {
          results.push(full);
        }
      }
    };
    walk(dir);
    return results;
  }

  private static globAllWorkspaceFiles(dir: string): string[] {
    const results: string[] = [];
    const walk = (d: string) => {
      let files: string[] = [];
      try {
        files = fs.readdirSync(d);
      } catch {
        return;
      }
      for (const f of files) {
        if (['node_modules', '.git', '.aura', 'state', 'dist', 'build'].includes(f)) continue;
        const full = path.join(d, f);
        try {
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            walk(full);
          } else if (stat.isFile() && stat.size <= 102400) {
            const ext = path.extname(f);
            if (['.py', '.rb', '.sh', '.md', '.txt'].includes(ext)) {
              results.push(full);
            }
          }
        } catch {}
      }
    };
    walk(dir);
    return results;
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
    const regexStr = '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
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

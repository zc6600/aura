import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import picocolors from 'picocolors';
import {
  GlobalRulesProvider,
  type ScannedGlobalRule,
} from '../../core/context/providers/globalRulesProvider.js';
import {
  HintProvider,
  type ScannedHint,
} from '../../core/context/providers/hintProvider.js';
import * as ConfigManager from '../../utils/configManager.js';
import type { AuraConfig } from '../../utils/configSchema.js';
import { hasMagicHint as hasMagicHintUtil } from '../../utils/fsUtils.js';
import * as PathResolver from '../../utils/pathResolver.js';
import * as UI from '../ui.js';

type Injectable = ScannedGlobalRule | ScannedHint;

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
    const envPath = auraDir || resolvedPath;

    const globalRulesProvider = new GlobalRulesProvider(resolvedPath, {
      envPath,
    });
    const hintProvider = new HintProvider(resolvedPath, { envPath });

    const globalRules = globalRulesProvider.scan();
    const hints = hintProvider.scan();

    const injectables: Injectable[] = [...globalRules, ...hints];

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
    const globalHintFile = path.join(
      os.homedir(),
      '.aura-framework',
      'global_hint.md',
    );
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
      console.log(
        '   mkdir -p ~/.aura-framework && touch ~/.aura-framework/global_hint.md',
      );
      console.log(
        '   Then edit the file with your preferences, global instructions, or target models/rules.',
      );
    }
    console.log('-'.repeat(60));
  }

  private static padRight(str: string, len: number): string {
    const cleanStr = str.replace(/\x1b\[\d+m/g, ''); // strip ansi for calculation
    if (cleanStr.length >= len) {
      return str;
    }
    return str + ' '.repeat(len - cleanStr.length);
  }
  public static hasMagicHint(file: string): boolean {
    return hasMagicHintUtil(file);
  }
}

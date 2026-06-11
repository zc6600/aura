import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ConfigManager from '../../../utils/configManager.js';
import { isPathIgnored } from '../../../utils/ignoreMatcher.js';

interface GlobalRulesProviderOptions {
  envPath?: string;
}

interface GlobalRulesConfig {
  hints?: {
    auto_inject_readme?: boolean;
    max_file_chars?: number;
    ignore_list?: string[];
  };
}

export interface ScannedGlobalRule {
  type: 'Global Rules';
  path: string;
  status: 'INJECTED' | 'IGNORED';
  reason: string | null;
  content?: string;
}

export class GlobalRulesProvider {
  private projectPath: string;
  private envPath: string;

  constructor(projectPath: string, options: GlobalRulesProviderOptions = {}) {
    this.projectPath = path.resolve(projectPath);
    this.envPath = options.envPath || this.projectPath;
  }

  public scan(): ScannedGlobalRule[] {
    const results: ScannedGlobalRule[] = [];
    const readmeFile = path.join(this.projectPath, 'AURA_README.md');
    if (fs.existsSync(readmeFile) && fs.statSync(readmeFile).isFile()) {
      const autoInject = this.shouldAutoInjectReadme();
      const ignored = this.isIgnored('AURA_README.md');

      const status = (!autoInject || ignored) ? 'IGNORED' : 'INJECTED';
      const reason = !autoInject
        ? 'auto_inject_readme: false'
        : ignored
          ? 'in ignore_list'
          : null;

      let content = '';
      if (status === 'INJECTED') {
        try {
          content = fs.readFileSync(readmeFile, 'utf-8').trim();
          const limit = this.fetchMaxFileChars();
          if (content.length > limit) {
            content =
              content.substring(0, limit) +
              ` ... [truncated: exceeds ${limit} character limit]`;
          }
        } catch (_e) {}
      }

      results.push({
        type: 'Global Rules',
        path: 'AURA_README.md',
        status,
        reason,
        content: content || undefined,
      });
    }
    return results;
  }

  public provide(): string | null {
    const rules: string[] = [];

    // 1. Read AURA_README.md via scan()
    const scanned = this.scan();
    const readmeRule = scanned.find((r) => r.path === 'AURA_README.md' && r.status === 'INJECTED');
    if (readmeRule && readmeRule.content) {
      rules.push(`### Project Instructions (AURA_README.md):\n${readmeRule.content}`);
    }

    // 2. Read ~/.aura-framework/global_hint.md (fallback to ~/.aura/global_hint.md)
    try {
      let globalHintFile = path.join(os.homedir(), '.aura-framework', 'global_hint.md');
      if (!fs.existsSync(globalHintFile) || !fs.statSync(globalHintFile).isFile()) {
        globalHintFile = path.join(os.homedir(), '.aura', 'global_hint.md');
      }
      if (
        fs.existsSync(globalHintFile) &&
        fs.statSync(globalHintFile).isFile()
      ) {
        let content = fs.readFileSync(globalHintFile, 'utf-8').trim();
        if (content) {
          const limit = this.fetchMaxFileChars();
          if (content.length > limit) {
            content =
              content.substring(0, limit) +
              ` ... [truncated: exceeds ${limit} character limit]`;
          }
          rules.push(
            `### Global User Preferences & Operational Rules:\n${content}`,
          );
        }
      }
    } catch (_e) {}

    return rules.length > 0 ? rules.join('\n\n') : null;
  }

  private shouldAutoInjectReadme(): boolean {
    const cfg = this.loadConfig();
    return cfg.hints?.auto_inject_readme !== false;
  }

  private fetchMaxFileChars(): number {
    const cfg = this.loadConfig();
    const limit = cfg.hints?.max_file_chars;
    return limit ? Number(limit) : 10000;
  }

  private isIgnored(relPath: string): boolean {
    const cfg = this.loadConfig();
    const ignoreList: string[] = cfg.hints?.ignore_list || [];
    return isPathIgnored(relPath, ignoreList);
  }

  private loadConfig(): GlobalRulesConfig {
    try {
      return (ConfigManager.load(this.envPath) as GlobalRulesConfig) || {};
    } catch (_e) {
      return {};
    }
  }
}

import fs from 'fs';
import path from 'path';
import os from 'os';
import { ConfigManager } from '../../../utils/configManager.js';

export class GlobalRulesProvider {
  private projectPath: string;
  private envPath: string;

  constructor(projectPath: string, options: any = {}) {
    this.projectPath = path.resolve(projectPath);
    this.envPath = options.envPath || this.projectPath;
  }

  public provide(): string | null {
    const rules: string[] = [];

    // 1. Read AURA_README.md
    if (this.shouldAutoInjectReadme() && !this.isIgnored('AURA_README.md')) {
      const readmeFile = path.join(this.projectPath, 'AURA_README.md');
      if (fs.existsSync(readmeFile) && fs.statSync(readmeFile).isFile()) {
        try {
          let content = fs.readFileSync(readmeFile, 'utf-8').trim();
          if (content) {
            const limit = this.fetchMaxFileChars();
            if (content.length > limit) {
              content = content.substring(0, limit) + ` ... [truncated: exceeds ${limit} character limit]`;
            }
            rules.push(`### Project Instructions (AURA_README.md):\n${content}`);
          }
        } catch (e) {}
      }
    }

    // 2. Read ~/.aura/global_hint.md
    try {
      const globalHintFile = path.join(os.homedir(), '.aura', 'global_hint.md');
      if (fs.existsSync(globalHintFile) && fs.statSync(globalHintFile).isFile()) {
        let content = fs.readFileSync(globalHintFile, 'utf-8').trim();
        if (content) {
          const limit = this.fetchMaxFileChars();
          if (content.length > limit) {
            content = content.substring(0, limit) + ` ... [truncated: exceeds ${limit} character limit]`;
          }
          rules.push(`### Global User Preferences & Operational Rules:\n${content}`);
        }
      }
    } catch (e) {}

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
    // Basic glob/match
    return ignoreList.some(pattern => {
      if (pattern === relPath || relPath.includes(pattern)) {
        return true;
      }
      return false;
    });
  }

  private loadConfig(): any {
    try {
      return ConfigManager.load(this.envPath) || {};
    } catch (e) {
      return {};
    }
  }
}

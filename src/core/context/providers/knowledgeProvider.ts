import fs from 'node:fs';
import path from 'node:path';
import * as ConfigManager from '../../../utils/configManager.js';

interface KnowledgeProviderOptions {
  envPath?: string;
}

interface KnowledgeConfig {
  hints?: {
    max_file_chars?: number;
    ignore_list?: string[];
  };
}

export class KnowledgeProvider {
  private projectPath: string;
  private envPath: string;

  constructor(projectPath: string, options: KnowledgeProviderOptions = {}) {
    this.projectPath = path.resolve(projectPath);
    this.envPath = options.envPath || this.projectPath;
  }

  public provide(): string {
    const knowledgePath = path.join(this.projectPath, 'knowledge');
    if (
      !fs.existsSync(knowledgePath) ||
      !fs.statSync(knowledgePath).isDirectory()
    ) {
      return '';
    }

    const items: string[] = [];
    const maxFileChars = this.fetchMaxFileChars();

    const walk = (dir: string) => {
      let files: string[] = [];
      try {
        files = fs.readdirSync(dir);
      } catch (_e) {
        return;
      }

      for (const name of files) {
        const fullPath = path.join(dir, name);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(fullPath);
        } catch (_e) {
          continue;
        }

        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (stat.isFile()) {
          if (name.endsWith('.hint')) continue;

          const relToKnowledge = path
            .relative(knowledgePath, fullPath)
            .replace(/\\/g, '/');
          const hintPath = `${fullPath}.hint`;
          const relHintPath = path
            .relative(this.projectPath, hintPath)
            .replace(/\\/g, '/');

          let hintStr = '';
          if (fs.existsSync(hintPath) && !this.isIgnored(relHintPath)) {
            try {
              let hintContent = fs.readFileSync(hintPath, 'utf-8').trim();
              if (hintContent) {
                if (hintContent.length > maxFileChars) {
                  hintContent = `${hintContent.substring(0, maxFileChars)} ... [truncated]`;
                }
                hintStr = ` (Context: ${hintContent})`;
              }
            } catch (_e) {}
          }

          items.push(`- ${relToKnowledge}${hintStr}`);
        }
      }
    };

    walk(knowledgePath);

    if (items.length === 0) {
      return '';
    }

    const section = ['# PROJECT KNOWLEDGE BASE'];
    section.push(items.join('\n'));
    return section.join('\n\n');
  }

  private fetchMaxFileChars(): number {
    try {
      const cfg: KnowledgeConfig = ConfigManager.load(this.envPath) || {};
      const limit = cfg.hints?.max_file_chars;
      return limit ? Number(limit) : 10000;
    } catch (_e) {
      return 10000;
    }
  }

  private isIgnored(relPath: string): boolean {
    try {
      const cfg: KnowledgeConfig = ConfigManager.load(this.envPath) || {};
      const ignoreList: string[] = cfg.hints?.ignore_list || [];
      return ignoreList.some((pattern) => {
        if (pattern === relPath || relPath.includes(pattern)) {
          return true;
        }
        return false;
      });
    } catch (_e) {
      return false;
    }
  }
}

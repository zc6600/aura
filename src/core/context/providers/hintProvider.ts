import fs from 'fs';
import path from 'path';
import os from 'os';
import { ConfigManager } from '../../../utils/configManager.js';

export class HintProvider {
  private projectPath: string;
  private envPath: string;
  private configCache: any;

  constructor(projectPath: string, options: any = {}) {
    this.projectPath = path.resolve(projectPath);
    this.envPath = options.envPath || this.projectPath;
    this.configCache = this.loadConfig();
  }

  public provide(): string | null {
    const hints: string[] = [];
    const maxChars = this.fetchMaxHintChars();
    const maxScanLines = this.fetchMaxScanLines();
    const maxFilesLimit = 1000;

    const isHomeOrRoot = this.projectPath === os.homedir() || this.projectPath === '/' || this.projectPath === 'C:\\';
    const maxDepth = isHomeOrRoot ? 2 : 5;
    let fileCount = 0;

    const walk = (dir: string, depth: number) => {
      if (depth >= maxDepth || fileCount >= maxFilesLimit) {
        return;
      }

      let children: string[] = [];
      try {
        children = fs.readdirSync(dir);
      } catch (e) {
        return;
      }

      for (const name of children) {
        const fullPath = path.join(dir, name);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(fullPath);
        } catch (e) {
          continue;
        }

        if (stat.isDirectory()) {
          if (name.startsWith('.') || ['node_modules', 'vendor', 'tmp', 'log', 'build', 'dist', 'coverage', 'state'].includes(name)) {
            continue;
          }
          walk(fullPath, depth + 1);
        } else if (stat.isFile()) {
          const isHintFile = name.endsWith('.hint');
          const isTargetCode = /\.(py|rb|sh|md|txt)$/.test(name);
          if (!isHintFile && !isTargetCode) continue;

          // Skip large files
          if (stat.size > 102400) continue;

          const relPath = path.relative(this.projectPath, fullPath).replace(/\\/g, '/');
          if (this.isIgnored(relPath)) continue;
          if (isHintFile && relPath.startsWith('knowledge/')) continue;

          fileCount++;
          if (fileCount > maxFilesLimit) {
            console.warn(`[WARNING] Magic hint scan reached file limit (${maxFilesLimit}). Truncating scan.`);
            break;
          }

          try {
            if (isHintFile) {
              let hintContent = fs.readFileSync(fullPath, 'utf-8').trim();
              if (hintContent) {
                if (hintContent.length > maxChars) {
                  console.warn(`[WARNING] Sidecar hint in ${relPath} was truncated because it exceeds the ${maxChars} character limit!`);
                  hintContent = hintContent.substring(0, maxChars) + ` ... [truncated: hint exceeds ${maxChars} character limit]`;
                }
                hints.push(`- [From ${relPath}]: ${hintContent}`);
              }
            } else {
              const fileContent = fs.readFileSync(fullPath, 'utf-8');
              const lines = fileContent.split('\n');
              const scanCount = Math.min(lines.length, maxScanLines);
              for (let i = 0; i < scanCount; i++) {
                const match = lines[i].match(/@aura-hint:\s*(.*)/);
                if (match) {
                  let hintContent = match[1].trim();
                  if (hintContent.length > maxChars) {
                    console.warn(`[WARNING] Aura-hint in ${relPath} was truncated because it exceeds the ${maxChars} character limit!`);
                    hintContent = hintContent.substring(0, maxChars) + ` ... [truncated: hint exceeds ${maxChars} character limit]`;
                  }
                  hints.push(`- [From ${relPath}]: ${hintContent}`);
                }
              }
            }
          } catch (e) {}
        }
      }
    };

    try {
      walk(this.projectPath, 0);
    } catch (e: any) {
      console.warn(`[WARNING] Error scanning for magic hints: ${e.message}`);
    }

    return hints.length > 0 ? hints.join('\n') : null;
  }

  private loadConfig(): any {
    try {
      return ConfigManager.load(this.envPath) || {};
    } catch (e) {
      return {};
    }
  }

  private fetchMaxHintChars(): number {
    const limit = this.configCache.hints?.max_hint_chars;
    return limit ? Number(limit) : 1000;
  }

  private fetchMaxScanLines(): number {
    const limit = this.configCache.hints?.max_scan_lines;
    return limit ? Number(limit) : 2000;
  }

  private isIgnored(relPath: string): boolean {
    const ignoreList: string[] = this.configCache.hints?.ignore_list || [];
    return ignoreList.some(pattern => {
      if (pattern === relPath || relPath.includes(pattern)) {
        return true;
      }
      return false;
    });
  }
}

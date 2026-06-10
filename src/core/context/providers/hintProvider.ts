import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fg from 'fast-glob';
import * as ConfigManager from '../../../utils/configManager.js';

interface HintConfig {
  hints?: {
    max_hint_chars?: number;
    max_scan_lines?: number;
    ignore_list?: string[];
  };
}

interface HintProviderOptions {
  envPath?: string;
}

export class HintProvider {
  private projectPath: string;
  private envPath: string;
  private configCache: HintConfig;

  constructor(projectPath: string, options: HintProviderOptions = {}) {
    this.projectPath = path.resolve(projectPath);
    this.envPath = options.envPath || this.projectPath;
    this.configCache = this.loadConfig();
  }

  public provide(): string | null {
    const hints: string[] = [];
    const maxChars = this.fetchMaxHintChars();
    const maxScanLines = this.fetchMaxScanLines();
    const maxFilesLimit = 1000;

    const isHomeOrRoot =
      this.projectPath === os.homedir() ||
      this.projectPath === '/' ||
      this.projectPath === 'C:\\';
    const maxDepth = isHomeOrRoot ? 2 : 5;
    let fileCount = 0;

    let files: fg.Entry[] = [];
    try {
      files = fg.sync(
        ['**/*.hint', '**/*.py', '**/*.rb', '**/*.sh', '**/*.md', '**/*.txt'],
        {
          cwd: this.projectPath,
          ignore: [
            '**/node_modules/**',
            '**/vendor/**',
            '**/tmp/**',
            '**/log/**',
            '**/build/**',
            '**/dist/**',
            '**/coverage/**',
            '**/state/**',
            '**/.*/**',
          ],
          absolute: true,
          deep: maxDepth,
          stats: true,
          followSymbolicLinks: false,
        },
      );
    } catch (e: unknown) {
      console.warn(
        `[WARNING] Error scanning for magic hints: ${(e as Error).message}`,
      );
    }

    for (const file of files) {
      if (fileCount >= maxFilesLimit) {
        console.warn(
          `[WARNING] Magic hint scan reached file limit (${maxFilesLimit}). Truncating scan.`,
        );
        break;
      }

      const fullPath = file.path;
      const size = file.stats?.size ?? 0;

      // Skip large files (100KB)
      if (size > 102400) continue;

      const name = path.basename(fullPath);
      const isHintFile = name.endsWith('.hint');

      const relPath = path
        .relative(this.projectPath, fullPath)
        .replace(/\\/g, '/');
      if (this.isIgnored(relPath)) continue;
      if (isHintFile && relPath.startsWith('knowledge/')) continue;

      fileCount++;

      try {
        if (isHintFile) {
          let hintContent = fs.readFileSync(fullPath, 'utf-8').trim();
          if (hintContent) {
            if (hintContent.length > maxChars) {
              console.warn(
                `[WARNING] Sidecar hint in ${relPath} was truncated because it exceeds the ${maxChars} character limit!`,
              );
              hintContent =
                hintContent.substring(0, maxChars) +
                ` ... [truncated: hint exceeds ${maxChars} character limit]`;
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
                console.warn(
                  `[WARNING] Aura-hint in ${relPath} was truncated because it exceeds the ${maxChars} character limit!`,
                );
                hintContent =
                  hintContent.substring(0, maxChars) +
                  ` ... [truncated: hint exceeds ${maxChars} character limit]`;
              }
              hints.push(`- [From ${relPath}]: ${hintContent}`);
            }
          }
        }
      } catch (_e) {}
    }

    return hints.length > 0 ? hints.join('\n') : null;
  }

  private loadConfig(): HintConfig {
    try {
      return (ConfigManager.load(this.envPath) as HintConfig) || {};
    } catch (_e) {
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
    return ignoreList.some((pattern) => {
      if (pattern === relPath || relPath.includes(pattern)) {
        return true;
      }
      return false;
    });
  }
}

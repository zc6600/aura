import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fg from 'fast-glob';
import * as ConfigManager from '../../../utils/configManager.js';
import { hasMagicHint } from '../../../utils/fsUtils.js';
import { isPathIgnored } from '../../../utils/ignoreMatcher.js';

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

export interface ScannedHint {
  type: '.hint File' | 'Magic Hint (@aura-hint)';
  path: string;
  status: 'INJECTED' | 'IGNORED';
  reason: string | null;
  content?: string;
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

  public scan(): ScannedHint[] {
    const results: ScannedHint[] = [];
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
      const fullPath = file.path;
      const size = file.stats?.size ?? 0;

      // Skip large files (100KB)
      if (size > 102400) continue;

      const name = path.basename(fullPath);
      const isHintFile = name.endsWith('.hint');
      const relPath = path
        .relative(this.projectPath, fullPath)
        .replace(/\\/g, '/');

      const type = isHintFile ? '.hint File' : 'Magic Hint (@aura-hint)';

      // If it's a knowledge hint file, check if it's a valid sidecar or standalone
      if (isHintFile && relPath.startsWith('knowledge/')) {
        const baseFile = fullPath.substring(0, fullPath.length - 5);
        const hasBase =
          fs.existsSync(baseFile) && fs.statSync(baseFile).isFile();
        if (!hasBase) {
          results.push({
            type,
            path: relPath,
            status: 'IGNORED',
            reason: 'standalone hint in knowledge base (unsupported)',
          });
          continue;
        }
      }

      // Check ignore
      const isIgnored = this.isIgnored(relPath);

      // Check if it has magic hint tag (if it's not a .hint file)
      let hasHint = isHintFile;
      let hintContent = '';

      if (!isHintFile) {
        if (!this.hasMagicHint(fullPath)) continue;
        hasHint = true;
        try {
          const fileContent = fs.readFileSync(fullPath, 'utf-8');
          const lines = fileContent.split('\n');
          const scanCount = Math.min(lines.length, maxScanLines);
          for (let i = 0; i < scanCount; i++) {
            const match = lines[i].match(/@aura-hint:\s*(.*)/);
            if (match) {
              hintContent = match[1].trim();
              break;
            }
          }
        } catch (_e) {}
      }

      if (!hasHint) continue;

      if (fileCount >= maxFilesLimit) {
        results.push({
          type,
          path: relPath,
          status: 'IGNORED',
          reason: 'reached file limit',
        });
        continue;
      }

      if (isIgnored) {
        results.push({
          type,
          path: relPath,
          status: 'IGNORED',
          reason: 'in ignore_list',
        });
        continue;
      }

      fileCount++;

      if (isHintFile) {
        try {
          hintContent = fs.readFileSync(fullPath, 'utf-8').trim();
        } catch (_e) {}
      }

      if (hintContent) {
        if (hintContent.length > maxChars) {
          console.warn(
            `[WARNING] ${type === '.hint File' ? 'Sidecar hint' : 'Aura-hint'} in ${relPath} was truncated because it exceeds the ${maxChars} character limit!`,
          );
          hintContent =
            hintContent.substring(0, maxChars) +
            ` ... [truncated: hint exceeds ${maxChars} character limit]`;
        }
      }

      results.push({
        type,
        path: relPath,
        status: 'INJECTED',
        reason: null,
        content: hintContent || undefined,
      });
    }

    return results;
  }

  public provide(): string | null {
    const scanned = this.scan();
    const hints = scanned
      .filter(
        (f) =>
          f.status === 'INJECTED' &&
          f.content &&
          !f.path.startsWith('knowledge/'),
      )
      .map((f) => `- [From ${f.path}]: ${f.content}`);
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
    return isPathIgnored(relPath, ignoreList);
  }

  private hasMagicHint(file: string): boolean {
    return hasMagicHint(file);
  }
}

import fs from 'fs';
import path from 'path';
import { ConfigManager } from '../../../utils/configManager.js';

export class DirectoryTreeProvider {
  private projectPath: string;
  private envPath: string;
  private configCache: any;

  constructor(projectPath: string, options: any = {}) {
    this.projectPath = path.resolve(projectPath);
    this.envPath = options.envPath || this.projectPath;
    this.configCache = this.loadConfig();
  }

  public provide(): string | null {
    try {
      const maxDepth = this.fetchMaxDepth();
      const maxFiles = this.fetchMaxFilesPerDir();
      const items = this.traverse(this.projectPath, 1, maxDepth, maxFiles);
      return items.length > 0 ? items.join('\n') : null;
    } catch (e) {
      return null;
    }
  }

  private loadConfig(): any {
    try {
      return ConfigManager.load(this.envPath) || {};
    } catch (e) {
      return {};
    }
  }

  private fetchMaxDepth(): number {
    const limit = this.configCache.directory_tree?.max_depth;
    return limit ? Number(limit) : 3;
  }

  private fetchMaxFilesPerDir(): number {
    const limit = this.configCache.directory_tree?.max_files_per_dir;
    return limit ? Number(limit) : 10;
  }

  private traverse(dir: string, currentDepth: number, maxDepth: number, maxFiles: number): string[] {
    if (currentDepth > maxDepth) {
      return [];
    }

    const items: string[] = [];
    let children: string[] = [];
    try {
      children = fs.readdirSync(dir).sort();
    } catch (e) {
      return [];
    }

    const dirs: string[] = [];
    const files: string[] = [];

    for (const name of children) {
      if (name.startsWith('.')) continue;
      if (['node_modules', 'vendor', 'tmp', 'log', 'build', 'dist', 'coverage', 'state'].includes(name)) {
        continue;
      }

      const fullPath = path.join(dir, name);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          dirs.push(name);
        } else if (stat.isFile()) {
          files.push(name);
        }
      } catch (e) {}
    }

    const indent = '  '.repeat(currentDepth - 1);
    const displayedFiles = files.slice(0, maxFiles);

    for (const name of displayedFiles) {
      items.push(`${indent}- [FILE] ${name}`);
    }

    if (files.length > maxFiles) {
      items.push(`${indent}- [FILE] ... (and ${files.length - maxFiles} more files)`);
    }

    for (const name of dirs) {
      items.push(`${indent}- [DIR ] ${name}`);
      const fullPath = path.join(dir, name);
      items.push(...this.traverse(fullPath, currentDepth + 1, maxDepth, maxFiles));
    }

    return items;
  }
}

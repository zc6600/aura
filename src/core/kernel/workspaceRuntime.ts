import fs from 'node:fs';
import path from 'node:path';
import * as PathResolver from '../../utils/pathResolver.js';
import { Runner } from './runner.js';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
}

export class WorkspaceRuntime {
  constructor(private readonly projectPath: string) {}

  public readFile(filePath: string): { content: string } {
    const safePath = this.validateWorkspaceFilePath(filePath);
    if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) {
      throw new Error(`File not found: ${filePath}`);
    }
    return { content: fs.readFileSync(safePath, 'utf-8') };
  }

  public writeFile(filePath: string, content: string): { success: true } {
    const safePath = this.validateWorkspaceFilePath(filePath);
    fs.mkdirSync(path.dirname(safePath), { recursive: true });
    fs.writeFileSync(safePath, content, 'utf-8');
    return { success: true };
  }

  public getFileTree(): { tree: FileNode[] } {
    let totalItemsCount = 0;
    const buildTree = (
      currentDir: string,
      currentDepth: number,
    ): FileNode[] => {
      const nodes: FileNode[] = [];
      if (currentDepth > 4 || totalItemsCount >= 1000) return nodes;

      let children: string[] = [];
      try {
        children = fs.readdirSync(currentDir).sort();
      } catch (_e) {
        return nodes;
      }

      for (const name of children) {
        if (totalItemsCount >= 1000) break;
        if (name.startsWith('.')) continue;

        const fullPath = path.join(currentDir, name);
        const relPath = path
          .relative(this.projectPath, fullPath)
          .replace(/\\/g, '/');

        const isIgnored = Runner.IGNORED_SCAN_DIRS.some(
          (d) =>
            relPath === d ||
            relPath.startsWith(`${d}/`) ||
            relPath.includes(`/${d}/`),
        );
        if (isIgnored) continue;

        try {
          const stat = fs.statSync(fullPath);
          totalItemsCount++;
          if (stat.isDirectory()) {
            nodes.push({
              name,
              path: relPath,
              type: 'dir',
              children: buildTree(fullPath, currentDepth + 1),
            });
          } else if (stat.isFile()) {
            nodes.push({ name, path: relPath, type: 'file' });
          }
        } catch (_e) {}
      }
      return nodes;
    };

    return { tree: buildTree(this.projectPath, 1) };
  }

  private validateWorkspaceFilePath(filePath: string): string {
    const safePath = PathResolver.validateSafePath(filePath, this.projectPath);
    const relative = path.relative(this.projectPath, safePath);
    const parts = relative.split(/[\\/]/);
    if (
      parts.includes('.git') ||
      parts.includes('.aura') ||
      parts.includes('.aura-workspace') ||
      parts.includes('node_modules')
    ) {
      throw new Error(`Access denied to restricted path: ${filePath}`);
    }
    return safePath;
  }
}

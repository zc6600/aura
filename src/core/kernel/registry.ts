import fs from 'fs';
import path from 'path';
import * as PathResolver from '../../utils/pathResolver.js';

export interface RegisteredTool {
  path: string;
  manifest: any;
  group?: string | null;
}

export class ToolRegistry {
  private projectPath: string;
  private envPath: string;
  private workspacePath: string;
  private toolsPaths: string[];
  private registry: Record<string, RegisteredTool> = {};
  private groups: Record<string, any> = {};
  private lastScanMtime: number | null = null;
  private notFoundCache: Set<string> = new Set();

  constructor(projectPath: string) {
    this.projectPath = path.resolve(projectPath);
    this.envPath = PathResolver.environmentPath(this.projectPath) || this.projectPath;
    this.workspacePath = this.projectPath; // Mapping to resolve workspace root

    this.toolsPaths = Array.from(new Set([
      path.join(this.workspacePath, 'tools'),
      path.join(this.envPath, 'tools'),
    ]));

    this.scan();
  }

  public find(toolName: string): RegisteredTool | null {
    this.maybeRefresh();
    if (Object.prototype.hasOwnProperty.call(this.registry, toolName)) {
      return this.registry[toolName];
    }
    if (this.notFoundCache.has(toolName)) {
      return null;
    }
    this.scan();
    const tool = this.registry[toolName] || null;
    if (!tool) {
      this.notFoundCache.add(toolName);
    }
    return tool;
  }

  public groupFor(toolName: string): string | null {
    return this.registry[toolName]?.group || null;
  }

  public allTools(): string[] {
    this.maybeRefresh();
    return Object.keys(this.registry);
  }

  public scan(): void {
    this.registry = {};
    this.groups = {};
    this.notFoundCache.clear();

    for (const toolsPath of this.toolsPaths) {
      if (fs.existsSync(toolsPath) && fs.statSync(toolsPath).isDirectory()) {
        try {
          const children = fs.readdirSync(toolsPath);
          for (const child of children) {
            const dir = path.join(toolsPath, child);
            if (fs.statSync(dir).isDirectory()) {
              this.scanDirectory(dir);
            }
          }
        } catch (e) {}
      }
    }
    this.lastScanMtime = this.latestToolsMtime();
  }

  private scanDirectory(dir: string): void {
    const groupPath = path.join(dir, 'group_manifest.json');
    const manifestPath = path.join(dir, 'manifest.json');

    if (fs.existsSync(groupPath)) {
      this.processGroup(dir);
    } else if (fs.existsSync(manifestPath)) {
      this.processStandaloneTool(dir);
    } else {
      try {
        const subdirs = fs.readdirSync(dir);
        for (const subdir of subdirs) {
          const fullSub = path.join(dir, subdir);
          if (fs.statSync(fullSub).isDirectory()) {
            this.scanDirectory(fullSub);
          }
        }
      } catch (e) {}
    }
  }

  private maybeRefresh(): void {
    const current = this.latestToolsMtime();
    if (this.lastScanMtime !== null && current <= this.lastScanMtime) {
      return;
    }
    this.scan();
  }

  private latestToolsMtime(): number {
    const mtimes: number[] = [0];
    for (const toolsPath of this.toolsPaths) {
      if (fs.existsSync(toolsPath) && fs.statSync(toolsPath).isDirectory()) {
        const scanMtime = (p: string) => {
          try {
            const stat = fs.statSync(p);
            mtimes.push(stat.mtimeMs);
          } catch (e) {}
        };

        scanMtime(toolsPath);

        const walk = (dir: string) => {
          let children: string[] = [];
          try {
            children = fs.readdirSync(dir);
          } catch (e) {
            return;
          }
          for (const name of children) {
            const fullPath = path.join(dir, name);
            if (name === 'manifest.json' || name === 'group_manifest.json') {
              scanMtime(fullPath);
            } else {
              try {
                if (fs.statSync(fullPath).isDirectory()) {
                  walk(fullPath);
                }
              } catch (e) {}
            }
          }
        };
        walk(toolsPath);
      }
    }
    return Math.max(...mtimes);
  }

  private processGroup(dir: string): void {
    const manifestPath = path.join(dir, 'group_manifest.json');
    try {
      const groupManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const groupName = groupManifest.group_name || path.basename(dir);
      this.groups[groupName] = {
        path: dir,
        manifest: groupManifest,
      };

      const entryTool = groupManifest.entry_tool;
      if (entryTool) {
        const entryDir = path.join(dir, entryTool);
        this.registerTool(entryDir, groupName);
      }

      const subtools = groupManifest.subtools || [];
      for (const subtoolName of subtools) {
        const subtoolDir = path.join(dir, subtoolName);
        this.registerTool(subtoolDir, groupName);
      }
    } catch (e: any) {
      if (this.warningsEnabled()) {
        console.warn(`[ToolRegistry] Failed to load group ${dir}: ${e.message}`);
      }
    }
  }

  private processStandaloneTool(dir: string): void {
    this.registerTool(dir);
  }

  private registerTool(dir: string, groupName: string | null = null): void {
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return;

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const name = manifest.name || path.basename(dir);
      this.registry[name] = {
        path: dir,
        manifest,
        group: groupName,
      };
    } catch (e: any) {
      if (this.warningsEnabled()) {
        console.warn(`[ToolRegistry] Failed to register tool ${dir}: ${e.message}`);
      }
    }
  }

  private warningsEnabled(): boolean {
    if (process.env.AURA_SILENCE_TOOL_REGISTRY_WARNINGS === '1') return false;
    if (process.env.AURA_TOOL_REGISTRY_WARNINGS === '1') return true;
    return process.env.NODE_ENV !== 'test';
  }
}

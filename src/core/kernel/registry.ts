import fs from 'node:fs';
import path from 'node:path';
import * as PathResolver from '../../utils/pathResolver.js';

export interface ToolManifest {
  name?: string;
  runtime?:
    | string
    | { language?: string; runtime?: string; entry_point?: string };
  entry?: string;
  timeout?: number;
  agent_can_modify_timeout?: boolean;
  permissions?: { allow_paths?: string[] };
  input_schema?: Record<string, unknown>;
  input?: Record<string, unknown>;
  requires_context?: string;
  creates_context?: string;
  description?: string;
  [key: string]: unknown;
}

export interface GroupManifest {
  group_name?: string;
  entry_tool?: string;
  subtools?: string[];
  context?: { name: string; lifecycle?: { ttl: Record<string, unknown> } };
  [key: string]: unknown;
}

export interface RegisteredTool {
  path: string;
  manifest: ToolManifest;
  group?: string | null;
}

export class ToolRegistry {
  private projectPath: string;
  private envPath: string;
  private workspacePath: string;
  private toolsPaths: string[];
  private registry: Record<string, RegisteredTool> = {};
  private groups: Record<string, GroupManifest> = {};
  private lastScanMtime: number | null = null;
  private notFoundCache: Set<string> = new Set();

  constructor(projectPath: string) {
    this.projectPath = path.resolve(projectPath);
    this.envPath =
      PathResolver.environmentPath(this.projectPath) || this.projectPath;
    this.workspacePath = this.projectPath; // Mapping to resolve workspace root

    this.toolsPaths = Array.from(
      new Set([
        path.join(this.workspacePath, 'tools'),
        path.join(this.envPath, 'tools'),
      ]),
    );

    this.scan();
  }

  public find(toolName: string): RegisteredTool | null {
    this.maybeRefresh();
    if (Object.hasOwn(this.registry, toolName)) {
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
        } catch (_e) {}
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
      } catch (_e) {}
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
          } catch (_e) {}
        };

        scanMtime(toolsPath);

        const walk = (dir: string) => {
          let children: string[] = [];
          try {
            children = fs.readdirSync(dir);
          } catch (_e) {
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
              } catch (_e) {}
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
      const groupManifest = JSON.parse(
        fs.readFileSync(manifestPath, 'utf-8'),
      ) as GroupManifest;
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
    } catch (e: unknown) {
      if (this.warningsEnabled()) {
        console.warn(
          `[ToolRegistry] Failed to load group ${dir}: ${(e as Error).message}`,
        );
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
      const manifest = JSON.parse(
        fs.readFileSync(manifestPath, 'utf-8'),
      ) as ToolManifest;
      const name = manifest.name || path.basename(dir);
      this.registry[name] = {
        path: dir,
        manifest,
        group: groupName,
      };
    } catch (e: unknown) {
      if (this.warningsEnabled()) {
        console.warn(
          `[ToolRegistry] Failed to register tool ${dir}: ${(e as Error).message}`,
        );
      }
    }
  }

  private warningsEnabled(): boolean {
    if (process.env.AURA_SILENCE_TOOL_REGISTRY_WARNINGS === '1') return false;
    if (process.env.AURA_TOOL_REGISTRY_WARNINGS === '1') return true;
    return process.env.NODE_ENV !== 'test';
  }
}

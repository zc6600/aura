import fs from 'fs';
import path from 'path';
import { ToolRegistry } from '../../kernel/registry.js';
import { ContextManager, ContextItem } from '../manager.js';
import { MCPManager } from '../../ext/mcp/manager.js';
import { ConfigManager } from '../../../utils/configManager.js';

export interface StructuredTool {
  name: string;
  description: string;
  input_schema: any;
  permissions: any;
  hint: string;
}

export class ToolProvider {
  private workspaceRoot: string;
  private envPath: string;
  private options: any;
  private state: any;
  private currentTurn: number;
  private registry: ToolRegistry;
  private manager: ContextManager;
  private mcpManager: MCPManager;
  private activeToolsList: StructuredTool[] = [];
  private loadedToolsList: string[] = [];

  constructor(workspacePath: string, options: any = {}) {
    const resolvedEnv = PathResolverEnvironment(workspacePath) || workspacePath;
    this.envPath = path.resolve(resolvedEnv);
    this.workspaceRoot = path.resolve(workspacePath);
    this.options = options || {};
    this.state = options.state;
    this.currentTurn = options.current_turn || 0;
    this.registry = new ToolRegistry(this.envPath);
    this.manager = new ContextManager(this.envPath);
    this.mcpManager = new MCPManager(this.envPath);
  }

  public provide(): string {
    try {
      const ttlConfigs = this.scanTtlConfigs();
      const activeContexts = this.manager.maintenance(this.currentTurn, ttlConfigs);

      this.loadedToolsList = [];
      this.activeToolsList = [];

      const toolNames = this.registry.allTools();
      for (const name of toolNames) {
        const toolData = this.registry.find(name);
        if (!toolData) continue;

        const manifest = toolData.manifest || {};
        const dir = toolData.path;

        if (manifest.requires_context) {
          this.processSubtool(name, dir, manifest, activeContexts);
        } else {
          this.processTopLevelTool(name, dir, manifest);
        }
      }

      this.appendMcpTools();
      this.appendLspTools();

      return ['# TOOLS', this.loadedToolsList.join('\n\n')].join('\n\n');
    } finally {
      try {
        this.mcpManager.shutdown();
      } catch (e) {}
    }
  }

  public provide_structured(): StructuredTool[] {
    if (this.activeToolsList.length === 0) {
      this.provide();
    }
    return this.activeToolsList;
  }

  private scanTtlConfigs(): Record<string, any> {
    const configs: Record<string, any> = {};
    const tps = Array.from(new Set([
      path.join(this.workspaceRoot, 'tools'),
      path.join(this.envPath, 'tools'),
    ]));

    for (const toolsDir of tps) {
      if (fs.existsSync(toolsDir) && fs.statSync(toolsDir).isDirectory()) {
        const walk = (dir: string) => {
          let files: string[] = [];
          try {
            files = fs.readdirSync(dir);
          } catch (e) {
            return;
          }
          for (const name of files) {
            const fullPath = path.join(dir, name);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.isDirectory()) {
                walk(fullPath);
              } else if (name === 'group_manifest.json') {
                const manifest = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
                if (manifest.context?.name) {
                  configs[manifest.context.name] = manifest.context.lifecycle?.ttl || {};
                }
              }
            } catch (e) {}
          }
        };
        walk(toolsDir);
      }
    }
    return configs;
  }

  private processSubtool(name: string, dir: string, manifest: any, activeContexts: Record<string, ContextItem>): void {
    const reqContext = manifest.requires_context;
    const activeInstances = Object.entries(activeContexts).filter(([_, ctx]) => ctx.type === reqContext);

    let desc = this.buildFullDescription(name, dir, manifest);
    if (activeInstances.length > 0) {
      const instanceIds = activeInstances.map(([id]) => id).join(', ');
      desc = desc.replace(new RegExp(`Requires: ${reqContext}`, 'g'), `Requires: ${reqContext} (Active instances: ${instanceIds})`);
    } else {
      desc = desc.replace(new RegExp(`Requires: ${reqContext}`, 'g'), `Requires: ${reqContext} (No active instances)`);
    }

    this.loadedToolsList.push(desc);
    this.activeToolsList.push({
      name,
      description: manifest.description || '',
      input_schema: manifest.input_schema || manifest.input || {},
      permissions: manifest.permissions || {},
      hint: this.loadHint(dir),
    });
  }

  private processTopLevelTool(name: string, dir: string, manifest: any): void {
    if (name === 'anchor_submit' && !this.anchorsHasFiles()) {
      return;
    }

    let breadcrumb = '';
    if (manifest.creates_context) {
      const subtools = this.findSubtoolsForContext(manifest.creates_context);
      if (subtools.length > 0) {
        breadcrumb = `\nUnlocks subtools: ${subtools.join(', ')}`;
      }
    }

    let desc = this.buildFullDescription(name, dir, manifest);
    if (breadcrumb) {
      desc += breadcrumb;
    }

    this.loadedToolsList.push(desc);
    this.activeToolsList.push({
      name,
      description: manifest.description || '',
      input_schema: manifest.input_schema || manifest.input || {},
      permissions: manifest.permissions || {},
      hint: this.loadHint(dir),
    });
  }

  private findSubtoolsForContext(contextType: string): string[] {
    return this.registry.allTools().filter(tname => {
      const t = this.registry.find(tname);
      return t?.manifest?.requires_context === contextType;
    });
  }

  private buildFullDescription(name: string, dir: string, manifest: any): string {
    const hint = this.loadHint(dir);
    const desc = manifest.description || '';
    const perms = manifest.permissions || {};
    const schema = manifest.input_schema || manifest.input || {};
    const usage = this.usageFromSchema(schema) || 'n/a';

    const reqContext = manifest.requires_context;
    const reqLine = reqContext ? `Requires: ${reqContext}` : '';

    const lines = [
      `## ${name}`,
      `Description: ${desc}`,
      reqLine,
      `Permissions: ${JSON.stringify(perms)}`,
      `Usage: ${usage}`,
      `Hint: ${hint}`,
    ].filter(Boolean);

    return lines.join('\n');
  }

  private loadHint(dir: string): string {
    try {
      const files = fs.readdirSync(dir);
      const hintFile = files.find(f => f.endsWith('.hint'));
      if (hintFile) {
        const fullPath = path.join(dir, hintFile);
        const relHintFile = this.relativize(fullPath);
        if (this.isIgnored(relHintFile)) {
          return 'No specific guidance provided.';
        }

        let content = fs.readFileSync(fullPath, 'utf-8').trim();
        const maxFileChars = this.fetchMaxFileChars();
        if (content.length > maxFileChars) {
          content = content.substring(0, maxFileChars) + ' ... [truncated]';
        }
        return content;
      }
    } catch (e) {}
    return 'No specific guidance provided.';
  }

  private usageFromSchema(schema: any): string | null {
    if (!schema || typeof schema !== 'object') {
      return null;
    }

    const props = schema.properties || {};
    const required = schema.required || [];
    const sample: Record<string, any> = {};

    for (const [k, v] of Object.entries(props)) {
      const val = v as any;
      if (val && typeof val === 'object') {
        switch (val.type) {
          case 'string':
            sample[k] = 'string';
            break;
          case 'number':
          case 'integer':
            sample[k] = 0;
            break;
          case 'boolean':
            sample[k] = false;
            break;
          case 'object':
            sample[k] = {};
            break;
          case 'array':
            sample[k] = [];
            break;
        }
      }
    }

    return JSON.stringify({ input: sample, required });
  }

  private loadConfig(): any {
    try {
      return ConfigManager.load(this.envPath) || {};
    } catch (e) {
      return {};
    }
  }

  private anchorsHasFiles(): boolean {
    const dir = path.join(this.envPath, 'anchors');
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return false;
    }
    try {
      const files = fs.readdirSync(dir);
      return files.some(f => {
        const ext = path.extname(f).toLowerCase();
        return ['.json', '.yaml', '.yml'].includes(ext) && fs.statSync(path.join(dir, f)).isFile();
      });
    } catch (e) {
      return false;
    }
  }

  private appendMcpTools(): void {
    try {
      const tools = this.mcpManager.listTools();
      for (const tool of tools) {
        this.loadedToolsList.push(this.buildMcpDescription(tool));
        this.activeToolsList.push({
          name: tool.name,
          description: tool.description || '',
          input_schema: tool.input_schema || {},
          permissions: {},
          hint: tool.hint || 'No specific guidance provided.',
        });
      }
    } catch (e) {}
  }

  private buildMcpDescription(tool: any): string {
    const name = tool.name;
    const desc = tool.description || '';
    const schema = tool.input_schema || {};
    const usage = this.usageFromSchema(schema) || 'n/a';
    const hint = tool.hint || 'No specific guidance provided.';

    return [
      `## ${name}`,
      `Description: ${desc}`,
      'Permissions: {}',
      `Usage: ${usage}`,
      `Hint: ${hint}`,
    ].join('\n');
  }

  private appendLspTools(): void {
    try {
      const schema = {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Optional relative path to inspect diagnostics for.' },
        },
      };
      this.loadedToolsList.push([
        '## lsp_diagnostics',
        'Description: Retrieve diagnostics warning and compile errors for files in workspace.',
        'Permissions: {}',
        `Usage: ${this.usageFromSchema(schema)}`,
        'Hint: Use this tool to get real-time feedback on code changes.',
      ].join('\n'));

      this.activeToolsList.push({
        name: 'lsp_diagnostics',
        description: 'Retrieve diagnostics warning and compile errors for files in workspace.',
        input_schema: schema,
        permissions: {},
        hint: 'Use this tool to get real-time feedback on code changes.',
      });
    } catch (e) {}
  }

  private fetchMaxFileChars(): number {
    const cfg = this.loadConfig();
    const limit = cfg.hints?.max_file_chars;
    return limit ? Number(limit) : 10000;
  }

  private relativize(filePath: string): string {
    const ws = this.workspaceRoot;
    const env = this.envPath;
    let out = filePath;
    if (ws) out = out.replace(new RegExp(`^${escapeRegExp(ws)}/?`), '');
    if (out === filePath && env) out = out.replace(new RegExp(`^${escapeRegExp(env)}/?`), '');
    return out;
  }

  private isIgnored(relPath: string): boolean {
    const cfg = this.loadConfig();
    const ignoreList: string[] = cfg.hints?.ignore_list || [];
    return ignoreList.some(pattern => pattern === relPath || relPath.includes(pattern));
  }
}

function PathResolverEnvironment(projectPath: string): string | null {
  // Simple fallback inline helper
  try {
    const auraDir = path.join(projectPath, '.aura');
    if (fs.existsSync(auraDir) && fs.statSync(auraDir).isDirectory()) {
      return auraDir;
    }
  } catch (e) {}
  return null;
}

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

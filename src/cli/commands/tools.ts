import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import picocolors from 'picocolors';
import yaml from 'yaml';
import { ToolRegistry } from '../../core/kernel/registry.js';
import * as GlobalConfig from '../../utils/globalConfig.js';
import * as PathResolver from '../../utils/pathResolver.js';
import * as UI from '../ui.js';

interface ManifestOverrides {
  name: string;
  creates_context?: string;
  requires_context?: string;
  destroys_context?: boolean;
  [key: string]: unknown;
}

interface InspectToolResult {
  tool?: string;
  status?: string;
  error?: string;
  code?: string;
  manifest?: Record<string, any>;
  files?: string[];
  hint?: string;
  magic_hints?: string[];
  tree?: string[];
}

export class Tools {
  public static list(
    projectPath?: string,
    options: { human?: boolean } = {},
  ): void {
    let resolvedPath = '';
    try {
      resolvedPath =
        PathResolver.resolveProjectPath(projectPath || undefined) ||
        process.cwd();
    } catch (e: unknown) {
      console.warn(
        picocolors.yellow(
          `⚠️ Warning: Failed to resolve project path: ${(e as Error).message}`,
        ),
      );
      resolvedPath = process.cwd();
    }

    const registry = new ToolRegistry(resolvedPath);
    const items = registry.allTools().map((name) => {
      const toolData = registry.find(name);
      const manifest = toolData ? toolData.manifest : {};
      return { tool: name, description: manifest.description || '' };
    });

    if (options.human) {
      const output = items.map((i) => `${i.tool}: ${i.description}`).join('\n');
      console.log(output);
    } else {
      console.log(JSON.stringify(items, null, 2));
    }
  }

  public static async inspect(
    name: string,
    options: { pretty?: boolean; human?: boolean } = {},
  ): Promise<void> {
    let resolvedPath = '';
    try {
      resolvedPath =
        PathResolver.resolveProjectPath(undefined) || process.cwd();
    } catch (e: unknown) {
      console.warn(
        picocolors.yellow(
          `⚠️ Warning: Failed to resolve project path: ${(e as Error).message}`,
        ),
      );
      resolvedPath = process.cwd();
    }

    const envPath = PathResolver.environmentPath(resolvedPath) || resolvedPath;
    const python = Tools.runtimePython(envPath);
    const logic = path.join(envPath, 'tools', 'inspect_tool', 'logic.py');

    if (!fs.existsSync(logic)) {
      throw new UI.ToolError(`inspect_tool not found under ${logic}`);
    }

    const payload = JSON.stringify({ tool_name: name });
    try {
      const { stdout, stderr } = await execa(python, [logic], {
        input: payload,
      });
      const text = stdout.trim() || stderr.trim();

      try {
        const data = JSON.parse(text) as InspectToolResult;
        if (options.human) {
          console.log(Tools.humanToolInspect(data, name, envPath));
        } else if (options.pretty) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(text);
        }
      } catch {
        console.log(text);
      }
    } catch (e: unknown) {
      throw new UI.ToolError(
        `Error running inspect_tool: ${(e as Error).message}`,
      );
    }
  }

  public static async add(toolNameOrUrl: string): Promise<void> {
    const isUrlOrLocal =
      toolNameOrUrl.startsWith('http://') ||
      toolNameOrUrl.startsWith('https://') ||
      toolNameOrUrl.startsWith('git@') ||
      (fs.existsSync(toolNameOrUrl) &&
        fs.statSync(toolNameOrUrl).isDirectory());

    if (isUrlOrLocal) {
      await Tools.install(toolNameOrUrl);
    } else {
      let resolvedPath = '';
      try {
        resolvedPath =
          PathResolver.resolveProjectPath(undefined) || process.cwd();
      } catch (e: unknown) {
        throw new UI.ToolError(
          `Failed to resolve project path: ${(e as Error).message}`,
        );
      }

      const libraryToolsDir = path.join(GlobalConfig.repoPath(), 'tools');
      const srcDir = path.join(libraryToolsDir, toolNameOrUrl);

      if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
        const available = Tools.availableLibraryTools(libraryToolsDir);
        throw new UI.ToolError(
          `Tool '${toolNameOrUrl}' not found in library. Available tools: ${available.join(', ')}`,
        );
      }

      const destDir = path.join(resolvedPath, 'tools', toolNameOrUrl);
      if (fs.existsSync(destDir)) {
        throw new UI.ToolError(
          `Tool '${toolNameOrUrl}' already exists at: ${destDir}`,
        );
      }

      fs.mkdirSync(path.dirname(destDir), { recursive: true });
      Tools.copyFolderSync(srcDir, destDir);
      UI.printSuccess(`Tool '${toolNameOrUrl}' installed successfully!`);
    }
  }

  public static async install(urlOrPath: string, name?: string): Promise<void> {
    let resolvedPath = '';
    try {
      resolvedPath =
        PathResolver.resolveProjectPath(undefined) || process.cwd();
    } catch (e: unknown) {
      throw new UI.ToolError(
        `Failed to resolve project path: ${(e as Error).message}`,
      );
    }

    const isGit =
      urlOrPath.startsWith('http://') ||
      urlOrPath.startsWith('https://') ||
      urlOrPath.startsWith('git@');
    const tmpPrefix = path.join(os.tmpdir(), 'tool_install_');
    const tmpDir = fs.mkdtempSync(tmpPrefix);

    try {
      let srcDir = '';
      if (isGit) {
        console.log(`Cloning repository: ${urlOrPath}...`);
        try {
          await execa('git', ['clone', '--depth', '1', urlOrPath, tmpDir]);
          srcDir = tmpDir;
        } catch (err: unknown) {
          throw new UI.ToolError(
            `Failed to clone repository: ${(err as Error).message}`,
          );
        }
      } else {
        srcDir = path.resolve(urlOrPath);
        if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
          throw new UI.ToolError(
            `Local path '${urlOrPath}' is not a directory.`,
          );
        }
      }

      let manifestPath = path.join(srcDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        const matches = Tools.globManifestJson(srcDir);
        if (matches.length > 0) {
          manifestPath = matches[0];
          srcDir = path.dirname(manifestPath);
        } else {
          throw new UI.ToolError(
            'No manifest.json file found in the source directory.',
          );
        }
      }

      let toolName = name;
      if (!toolName || toolName.trim().length === 0) {
        try {
          const manifestData = JSON.parse(
            fs.readFileSync(manifestPath, 'utf-8'),
          );
          toolName = manifestData.name;
        } catch {}
        if (!toolName) {
          toolName = path
            .basename(srcDir)
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '');
        }
      }

      const destDir = path.join(resolvedPath, 'tools', toolName);
      if (fs.existsSync(destDir)) {
        throw new UI.ToolError(
          `Tool '${toolName}' already exists at: ${destDir}`,
        );
      }

      fs.mkdirSync(path.dirname(destDir), { recursive: true });
      Tools.copyFolderSync(srcDir, destDir);

      const innerGit = path.join(destDir, '.git');
      if (fs.existsSync(innerGit)) {
        fs.rmSync(innerGit, { recursive: true, force: true });
      }

      UI.printSuccess(
        `Tool '${toolName}' successfully installed to: ${destDir}`,
      );
    } finally {
      try {
        if (fs.existsSync(tmpDir)) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      } catch {}
    }
  }

  public static generateGroup(name: string, subtools: string[]): void {
    let resolvedPath = '';
    try {
      resolvedPath =
        PathResolver.resolveProjectPath(undefined) || process.cwd();
    } catch (e: unknown) {
      throw new UI.ToolError(
        `Failed to resolve project path: ${(e as Error).message}`,
      );
    }

    const groupDir = path.join(resolvedPath, 'tools', name);
    if (fs.existsSync(groupDir)) {
      throw new UI.ToolError(`Tool group '${name}' already exists.`);
    }

    fs.mkdirSync(groupDir, { recursive: true });

    const manifest = {
      group_name: name,
      description: `${name.charAt(0).toUpperCase() + name.slice(1)} tool group`,
      entry_tool: 'open',
      context: {
        name: `${name}_session`,
        multi_instance: true,
        lifecycle: {
          created_by: 'open',
          destroyed_by: ['close'],
          ttl: {
            turns: 20,
            seconds: 600,
            policy: 'any',
          },
        },
      },
      subtools: ['close', ...subtools],
    };

    fs.writeFileSync(
      path.join(groupDir, 'group_manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    );

    // Create open
    Tools.createTool(path.join(groupDir, 'open'), {
      name: `${name}_open`,
      creates_context: `${name}_session`,
    });

    // Create close
    Tools.createTool(path.join(groupDir, 'close'), {
      name: `${name}_close`,
      requires_context: `${name}_session`,
      destroys_context: true,
    });

    // Create subtools
    for (const st of subtools) {
      Tools.createTool(path.join(groupDir, st), {
        name: `${name}_${st}`,
        requires_context: `${name}_session`,
      });
    }

    UI.printSuccess(
      `Tool group '${name}' generated successfully under tools/${name}`,
    );
  }

  private static createTool(
    dir: string,
    manifestOverrides: ManifestOverrides,
  ): void {
    fs.mkdirSync(dir, { recursive: true });

    const manifest = {
      description: `Description for ${manifestOverrides.name}`,
      runtime: 'python3',
      entry: 'logic.py',
      auto_load: !!manifestOverrides.creates_context,
      input_schema: {
        type: 'object',
        properties: {
          context_id: { type: 'string' },
        },
        required: manifestOverrides.requires_context ? ['context_id'] : [],
      },
      ...manifestOverrides,
    };

    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(dir, 'logic.py'),
      "#!/usr/bin/env python\nimport sys, json\n\nargs = json.loads(sys.stdin.read())\nprint(json.dumps({'success': True}))\n",
      { mode: 0o755 },
    );
  }

  private static runtimePython(envPath: string): string {
    const configYml = path.join(envPath, 'config', 'config.yml');
    try {
      if (fs.existsSync(configYml)) {
        const data = yaml.parse(fs.readFileSync(configYml, 'utf-8')) || {};
        let resolved = data.tool_protocol?.runtimes?.python || 'python';
        if (resolved === 'python3') resolved = 'python';
        return resolved;
      }
    } catch {}
    return 'python';
  }

  private static availableLibraryTools(libraryToolsDir: string): string[] {
    if (!fs.existsSync(libraryToolsDir)) return [];
    try {
      return fs.readdirSync(libraryToolsDir).filter((f) => {
        const full = path.join(libraryToolsDir, f);
        return fs.statSync(full).isDirectory();
      });
    } catch {
      return [];
    }
  }

  private static humanToolInspect(
    data: InspectToolResult,
    requestedName: string,
    envPath: string,
  ): string {
    const lines: string[] = [];
    const tname = data.tool || requestedName;
    lines.push(`Tool: ${tname}`);
    if (data.status) lines.push(`Status: ${data.status}`);
    if (data.error) lines.push(`Error: ${data.error}`);
    if (data.code) lines.push(`Code: ${data.code}`);

    const man = data.manifest || {};
    if (man.name) lines.push(`Name: ${man.name}`);
    if (man.description) lines.push(`Description: ${man.description}`);
    if (man.runtime) lines.push(`Runtime: ${man.runtime}`);
    if (man.permissions)
      lines.push(`Permissions: ${JSON.stringify(man.permissions)}`);

    const files = data.files || [];
    if (files.length > 0) lines.push(`Files: ${files.join(', ')}`);

    const hint = data.hint || data.magic_hints?.[0];
    if (hint) lines.push(`Hint: ${hint}`);

    if (man.input_schema && typeof man.input_schema === 'object') {
      const props = man.input_schema.properties || {};
      const req = man.input_schema.required || [];
      if (Object.keys(props).length > 0) {
        lines.push(`Input keys: ${Object.keys(props).join(', ')}`);
      }
      if (req.length > 0) {
        lines.push(`Required: ${req.join(', ')}`);
      }
    }

    if (Array.isArray(data.tree) && data.tree.length > 0) {
      lines.push('Tree:');
      lines.push(...data.tree.slice(0, 30));
    }

    const reqFiles = Tools.requiredFilesFromConfig(envPath);
    if (reqFiles.length > 0 && files.length > 0) {
      const missing = reqFiles.filter((rf) => !files.includes(rf));
      if (missing.length > 0) {
        lines.push(`Missing: ${missing.join(', ')}`);
      }
    }

    if (data.status && data.status !== 'ok') {
      let suggestion = '';
      if (data.code === 'not_found') {
        suggestion = `Suggestion: 创建 tools/${tname} 或运行 aura tools add ${tname}`;
      } else if (data.code === 'execution_error') {
        suggestion = 'Suggestion: 修复逻辑或清理 __pycache__ 后重试';
      } else if (data.code) {
        suggestion = `Suggestion: 根据错误码 ${data.code} 修复配置或权限`;
      } else {
        suggestion = 'Suggestion: 检查 manifest.json 与 logic.py 是否完整';
      }
      lines.push(suggestion);
    }

    return lines.join('\n');
  }

  private static requiredFilesFromConfig(envPath: string): string[] {
    const configYml = path.join(envPath, 'config', 'config.yml');
    try {
      if (fs.existsSync(configYml)) {
        const data = yaml.parse(fs.readFileSync(configYml, 'utf-8')) || {};
        const req = data.tool_protocol?.required_files || [];
        return Array.isArray(req) ? req : [];
      }
    } catch {}
    return [];
  }

  private static globManifestJson(dir: string): string[] {
    const results: string[] = [];
    const walk = (d: string) => {
      const files = fs.readdirSync(d);
      for (const f of files) {
        if (f === 'node_modules' || f === '.git' || f === '.aura-workspace' || f === '.aura') continue;
        const full = path.join(d, f);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (f === 'manifest.json') {
          results.push(full);
        }
      }
    };
    walk(dir);
    return results;
  }

  private static copyFolderSync(from: string, to: string) {
    fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from).forEach((element) => {
      const fromPath = path.join(from, element);
      const toPath = path.join(to, element);
      if (fs.lstatSync(fromPath).isDirectory()) {
        Tools.copyFolderSync(fromPath, toPath);
      } else {
        fs.copyFileSync(fromPath, toPath);
      }
    });
  }
}

import fs from 'node:fs';
import path from 'node:path';
import * as ConfigManager from '../../../utils/configManager.js';
import { environmentPath } from '../../../utils/pathResolver.js';
import { asRecord } from '../../../utils/typing.js';
import { MCPManager, type MCPTool } from '../../ext/mcp/manager.js';
import { type ToolManifest, ToolRegistry } from '../../kernel/registry.js';
import { type ContextItem, ContextManager } from '../manager.js';

export interface StructuredTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  permissions: Record<string, unknown>;
  hint: string;
}

interface ToolProviderOptions {
  state?: unknown;
  current_turn?: number;
}

export class ToolProvider {
  private workspaceRoot: string;
  private envPath: string;
  private state: unknown;
  private currentTurn: number;
  private registry: ToolRegistry;
  private manager: ContextManager;
  private mcpManager: MCPManager;
  private activeToolsList: StructuredTool[] = [];
  private loadedToolsList: string[] = [];
  public readonly options: ToolProviderOptions;

  constructor(workspacePath: string, options: ToolProviderOptions = {}) {
    const resolvedEnv = environmentPath(workspacePath) || workspacePath;
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
      const activeContexts = this.manager.maintenance(
        this.currentTurn,
        ttlConfigs,
      );

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
      this.appendWaitForProcessTool();
      this.appendSleepAndWakeTool();
      this.appendSendProcessInputTool();
      this.appendAuraRegistryRecordTool();
      this.appendAuraRegistryBestTool();
      this.appendAuraCsvValidateTool();

      return ['# TOOLS', this.loadedToolsList.join('\n\n')].join('\n\n');
    } finally {
      try {
        this.mcpManager.shutdown();
      } catch (_e) {}
    }
  }

  public provide_structured(): StructuredTool[] {
    if (this.activeToolsList.length === 0) {
      this.provide();
    }
    return this.activeToolsList;
  }

  private scanTtlConfigs(): Record<string, Record<string, unknown>> {
    const configs: Record<string, Record<string, unknown>> = {};
    const tps = Array.from(
      new Set([
        path.join(this.workspaceRoot, 'tools'),
        path.join(this.envPath, 'tools'),
      ]),
    );

    for (const toolsDir of tps) {
      if (fs.existsSync(toolsDir) && fs.statSync(toolsDir).isDirectory()) {
        const walk = (dir: string) => {
          let files: string[] = [];
          try {
            files = fs.readdirSync(dir);
          } catch (_e) {
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
                  configs[manifest.context.name] =
                    manifest.context.lifecycle?.ttl || {};
                }
              }
            } catch (_e) {}
          }
        };
        walk(toolsDir);
      }
    }
    return configs;
  }

  private processSubtool(
    name: string,
    dir: string,
    manifest: ToolManifest,
    activeContexts: Record<string, ContextItem>,
  ): void {
    const reqContext = manifest.requires_context;
    const activeInstances = Object.entries(activeContexts).filter(
      ([_, ctx]) => ctx.type === reqContext,
    );

    let desc = this.buildFullDescription(name, dir, manifest);
    if (activeInstances.length > 0) {
      const instanceIds = activeInstances.map(([id]) => id).join(', ');
      desc = desc.replace(
        new RegExp(`Requires: ${reqContext}`, 'g'),
        `Requires: ${reqContext} (Active instances: ${instanceIds})`,
      );
    } else {
      desc = desc.replace(
        new RegExp(`Requires: ${reqContext}`, 'g'),
        `Requires: ${reqContext} (No active instances)`,
      );
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

  private processTopLevelTool(
    name: string,
    dir: string,
    manifest: ToolManifest,
  ): void {
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
    return this.registry.allTools().filter((tname) => {
      const t = this.registry.find(tname);
      return t?.manifest?.requires_context === contextType;
    });
  }

  private buildFullDescription(
    name: string,
    dir: string,
    manifest: ToolManifest,
  ): string {
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
      const hintFile = files.find((f) => f.endsWith('.hint'));
      if (hintFile) {
        const fullPath = path.join(dir, hintFile);
        const relHintFile = this.relativize(fullPath);
        if (this.isIgnored(relHintFile)) {
          return 'No specific guidance provided.';
        }

        let content = fs.readFileSync(fullPath, 'utf-8').trim();
        const maxFileChars = this.fetchMaxFileChars();
        if (content.length > maxFileChars) {
          content = `${content.substring(0, maxFileChars)} ... [truncated]`;
        }
        return content;
      }
    } catch (_e) {}
    return 'No specific guidance provided.';
  }

  private usageFromSchema(schema: Record<string, unknown>): string | null {
    if (!schema || typeof schema !== 'object') {
      return null;
    }

    const props = (schema.properties as Record<string, unknown>) || {};
    const required = (schema.required as string[]) || [];
    const sample: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(props)) {
      const val = v as Record<string, unknown>;
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

  private loadConfig(): Record<string, unknown> {
    try {
      return ConfigManager.load(this.envPath) || {};
    } catch (_e) {
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
      return files.some((f) => {
        const ext = path.extname(f).toLowerCase();
        return (
          ['.json', '.yaml', '.yml'].includes(ext) &&
          fs.statSync(path.join(dir, f)).isFile()
        );
      });
    } catch (_e) {
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
    } catch (_e) {}
  }

  private buildMcpDescription(tool: MCPTool): string {
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
          file_path: {
            type: 'string',
            description: 'Optional relative path to inspect diagnostics for.',
          },
        },
      };
      this.loadedToolsList.push(
        [
          '## lsp_diagnostics',
          'Description: Retrieve diagnostics warning and compile errors for files in workspace.',
          'Permissions: {}',
          `Usage: ${this.usageFromSchema(schema)}`,
          'Hint: Use this tool to get real-time feedback on code changes.',
        ].join('\n'),
      );

      this.activeToolsList.push({
        name: 'lsp_diagnostics',
        description:
          'Retrieve diagnostics warning and compile errors for files in workspace.',
        input_schema: schema,
        permissions: {},
        hint: 'Use this tool to get real-time feedback on code changes.',
      });
    } catch (_e) {}
  }

  private appendWaitForProcessTool(): void {
    try {
      const schema = {
        type: 'object',
        properties: {
          pid: {
            type: 'number',
            description: 'The process PID returned by a background launch.',
          },
          timeout_seconds: {
            type: 'number',
            description:
              'How long to block waiting (default 30). Pass a small value (e.g. 5) ' +
              'to poll without committing — if the process is still running you will ' +
              'get {status: "running", pid} back and can call this again later.',
          },
        },
        required: ['pid'],
      };
      const hint =
        'POLLING PATTERN: start a background task → call wait_for_process with ' +
        'timeout_seconds=5 to check → if still running, do other work or call ' +
        'sleep_and_wake, then poll again. When process exits, its output is returned.';
      this.loadedToolsList.push(
        [
          '## wait_for_process',
          'Description: Wait for (or poll) a background process. Returns the process ' +
            'result when it exits, or {status: "running", pid} if still running within timeout.',
          'Permissions: {}',
          `Usage: ${this.usageFromSchema(schema)}`,
          `Hint: ${hint}`,
        ].join('\n'),
      );
      this.activeToolsList.push({
        name: 'wait_for_process',
        description:
          'Wait for (or poll) a background process. Returns result when done or {status: "running", pid} if still alive.',
        input_schema: schema,
        permissions: {},
        hint,
      });
    } catch (_e) {}
  }

  private appendSleepAndWakeTool(): void {
    try {
      const schema = {
        type: 'object',
        properties: {
          seconds: {
            type: 'number',
            description:
              'Number of seconds to sleep before being automatically resumed.',
          },
          reason: {
            type: 'string',
            description:
              'Optional note explaining why you are sleeping (stored as context on wake).',
          },
        },
        required: ['seconds'],
      };
      const hint =
        'Use this instead of busy-polling. After the timer fires the system resumes ' +
        'your turn with a fresh context observation so you can check background tasks, ' +
        'inspect files, and decide next steps. Max sleep is 3600 seconds (1 hour).';
      this.loadedToolsList.push(
        [
          '## sleep_and_wake',
          'Description: Pause execution for N seconds, then automatically resume. ' +
            'Use this while waiting for long-running background tasks instead of blocking with wait_for_process.',
          'Permissions: {}',
          `Usage: ${this.usageFromSchema(schema)}`,
          `Hint: ${hint}`,
        ].join('\n'),
      );
      this.activeToolsList.push({
        name: 'sleep_and_wake',
        description:
          'Pause for N seconds and auto-resume. Use while waiting for background tasks.',
        input_schema: schema,
        permissions: {},
        hint,
      });
    } catch (_e) {}
  }

  private appendSendProcessInputTool(): void {
    try {
      const schema = {
        type: 'object',
        properties: {
          pid: {
            type: 'number',
            description: 'PID of the interactive background process.',
          },
          input: {
            type: 'string',
            description:
              'Text to send as stdin (e.g. "yes", "no", a password, a file path). ' +
              'A newline is appended automatically.',
          },
        },
        required: ['pid', 'input'],
      };
      const hint =
        'Use this when you receive an execute/onInteractivePrompt notification. ' +
        'The process must have been started with background:true and pty:true. ' +
        'Send exactly what the prompt expects — "y" or "n" for yes/no, the actual ' +
        'value for text prompts.';
      this.loadedToolsList.push(
        [
          '## send_process_input',
          'Description: Send text input to a background PTY process that is waiting for stdin ' +
            '(e.g. responding to a [y/n] prompt or password request).',
          'Permissions: {}',
          `Usage: ${this.usageFromSchema(schema)}`,
          `Hint: ${hint}`,
        ].join('\n'),
      );
      this.activeToolsList.push({
        name: 'send_process_input',
        description:
          'Send stdin input to a PTY background process that is waiting for user input.',
        input_schema: schema,
        permissions: {},
        hint,
      });
    } catch (_e) {}
  }

  private fetchMaxFileChars(): number {
    const cfg = asRecord(this.loadConfig());
    const hints = asRecord(cfg.hints);
    const limit = hints.max_file_chars;
    return limit ? Number(limit) : 10000;
  }

  private relativize(filePath: string): string {
    const ws = this.workspaceRoot;
    const env = this.envPath;
    let out = filePath;
    if (ws) out = out.replace(new RegExp(`^${escapeRegExp(ws)}/?`), '');
    if (out === filePath && env)
      out = out.replace(new RegExp(`^${escapeRegExp(env)}/?`), '');
    return out;
  }

  private isIgnored(relPath: string): boolean {
    const cfg = asRecord(this.loadConfig());
    const hints = asRecord(cfg.hints);
    const ignoreList = Array.isArray(hints.ignore_list)
      ? hints.ignore_list.map(String)
      : [];
    return ignoreList.some(
      (pattern) => pattern === relPath || relPath.includes(pattern),
    );
  }

  private appendAuraRegistryRecordTool(): void {
    try {
      const schema = {
        type: 'object',
        properties: {
          run_id: {
            type: 'string',
            description: 'Unique identifier for the experiment run.',
          },
          status: {
            type: 'string',
            description: 'Status of the candidate (default candidate).',
          },
          hypothesis: {
            type: 'string',
            description: 'Brief hypothesis for this experiment run.',
          },
          model_family: {
            type: 'string',
            description: 'Algorithm or model architecture used.',
          },
          metric_name: {
            type: 'string',
            description: 'Name of validation metric.',
          },
          cv_score: { type: 'number', description: 'Validation score.' },
          cv_std: {
            type: 'number',
            description: 'Standard deviation of CV score.',
          },
          higher_is_better: {
            type: 'boolean',
            description: 'Whether a higher score is better.',
          },
          params: {
            type: 'object',
            description: 'Hyperparameters dictionary.',
          },
          changed_files: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of changed files.',
          },
          artifacts: {
            type: 'object',
            description: 'Map of generated artifacts.',
          },
          submission_path: {
            type: 'string',
            description: 'Path to local submission CSV.',
          },
          notes: { type: 'string', description: 'Experiment run notes.' },
        },
        required: ['run_id'],
      };
      const hint =
        'Log validation scores, models, parameters, and submission artifacts in the experiment registry.';
      this.loadedToolsList.push(
        [
          '## aura.registry.record',
          'Description: Record an experiment run details in the registry.',
          'Permissions: {}',
          `Usage: ${this.usageFromSchema(schema)}`,
          `Hint: ${hint}`,
        ].join('\n'),
      );
      this.activeToolsList.push({
        name: 'aura.registry.record',
        description: 'Record an experiment run in the registry.',
        input_schema: schema,
        permissions: {},
        hint,
      });
    } catch (_e) {}
  }

  private appendAuraRegistryBestTool(): void {
    try {
      const schema = {
        type: 'object',
        properties: {
          metric_name: {
            type: 'string',
            description:
              'Optionally query a specific metric (default cv_score).',
          },
        },
        required: [],
      };
      const hint =
        'Retrieves the run details with the best CV score from the experiment database.';
      this.loadedToolsList.push(
        [
          '## aura.registry.best',
          'Description: Get the best recorded run from the registry.',
          'Permissions: {}',
          `Usage: ${this.usageFromSchema(schema)}`,
          `Hint: ${hint}`,
        ].join('\n'),
      );
      this.activeToolsList.push({
        name: 'aura.registry.best',
        description: 'Retrieve the best recorded run in the registry.',
        input_schema: schema,
        permissions: {},
        hint,
      });
    } catch (_e) {}
  }

  private appendAuraCsvValidateTool(): void {
    try {
      const schema = {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Path to target CSV file to validate.',
          },
          align_with: {
            type: 'string',
            description:
              'Path to sample CSV file to align column structures and counts against.',
          },
          rules: {
            type: 'array',
            items: { type: 'string' },
            description:
              'List of rules to assert: columns_match, row_count_match, id_ordered, no_missing',
          },
        },
        required: ['target', 'align_with'],
      };
      const hint =
        'Zero-code data verification. Ensures columns match, row counts match sample, and IDs are identical row-by-row.';
      this.loadedToolsList.push(
        [
          '## aura.csv.validate',
          'Description: Validate submission CSV formatting against a sample CSV.',
          'Permissions: {}',
          `Usage: ${this.usageFromSchema(schema)}`,
          `Hint: ${hint}`,
        ].join('\n'),
      );
      this.activeToolsList.push({
        name: 'aura.csv.validate',
        description: 'Validate CSV structure alignment against a sample.',
        input_schema: schema,
        permissions: {},
        hint,
      });
    } catch (_e) {}
  }
}

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

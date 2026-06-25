import fs from 'node:fs';
import path from 'node:path';
import picocolors from 'picocolors';
import yaml from 'yaml';
import { ContextAssembler } from '../../core/context/assembler.js';
import { ToolRegistry } from '../../core/kernel/registry.js';
import type { Runner } from '../../core/kernel/runner.js';
import * as Env from '../../core/llm/env.js';
import { SessionManager } from '../../core/memory/sessionManager.js';
import * as GlobalConfig from '../../utils/globalConfig.js';
import * as PathResolver from '../../utils/pathResolver.js';
import * as UI from '../ui.js';

type ShellConfig = Record<string, unknown> & {
  llm?: {
    provider?: string;
    model?: string;
    api_key?: string;
    api_key_env?: string;
    api_base?: string;
    max_retries?: number;
  };
};

export class SlashCommandManager {
  private projectPath: string;
  private configLoader: () => Record<string, unknown>;
  private runner: Runner;
  private onReload?: () => void;

  constructor(
    projectPath: string,
    configLoader: () => Record<string, unknown>,
    runner: Runner,
    options: { onReload?: () => void } = {},
  ) {
    this.projectPath = path.resolve(projectPath);
    this.configLoader = configLoader;
    this.runner = runner;
    this.onReload = options.onReload;
  }

  public async handle(input: string): Promise<boolean> {
    if (!input.startsWith('/')) {
      return false;
    }

    const parts = input.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case '/model':
        await this.handleModel(args);
        break;
      case '/provider':
        await this.handleProvider(args);
        break;
      case '/settings':
        this.handleSettings();
        break;
      case '/help':
        this.handleHelp();
        break;
      case '/undo':
        this.handleUndo();
        break;
      case '/redo':
        this.handleRedo();
        break;
      case '/session':
        await this.handleSession(args);
        break;
      case '/context':
        this.handleContext();
        break;
      case '/tools':
        this.handleTools();
        break;
      case '/skills':
        this.handleSkills();
        break;
      case '/auto':
        this.handleAuto(args);
        break;
      default:
        console.log(`Unknown command: ${cmd}`);
        break;
    }

    return true;
  }

  private handleContext(): void {
    const root = path.resolve(this.projectPath);
    const out = ContextAssembler.assemble(root, this.runner.memory.store.db);
    console.log(out.toMarkdown());
  }

  private handleTools(): void {
    const registry = new ToolRegistry(this.projectPath);
    const items = registry.allTools();
    if (items.length === 0) {
      console.log('No tools registered in this project workspace.');
    } else {
      console.log('Registered Tools:');
      console.log('-'.repeat(60));
      for (const name of items) {
        const toolData = registry.find(name);
        const desc =
          toolData?.manifest?.description || 'No description provided.';
        console.log(`  * ${name.padEnd(25)} - ${desc}`);
      }
    }
  }

  private handleSkills(): void {
    const skillsDir = path.join(this.projectPath, 'skills');
    const templateSkillsDir = path.join(GlobalConfig.repoPath(), 'skills');

    const skillPaths: Record<string, string> = {};
    for (const baseDir of [templateSkillsDir, skillsDir]) {
      if (fs.existsSync(baseDir) && fs.statSync(baseDir).isDirectory()) {
        try {
          const files = fs.readdirSync(baseDir);
          for (const file of files) {
            const skillFile = path.join(baseDir, file, 'SKILL.md');
            if (fs.existsSync(skillFile)) {
              skillPaths[file] = skillFile;
            }
          }
        } catch {}
      }
    }

    const sortedNames = Object.keys(skillPaths).sort();
    if (sortedNames.length === 0) {
      console.log('No skills found in workspace.');
    } else {
      console.log('Available Agent Skills:');
      console.log('-'.repeat(60));
      for (const name of sortedNames) {
        const filePath = skillPaths[name];
        const meta = this.parseSkillMeta(filePath, name);
        console.log(`  * ${name.padEnd(25)} - ${meta.description}`);
      }
    }
  }

  private parseSkillMeta(
    filePath: string,
    defaultName: string,
  ): { name: string; description: string } {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const meta = {
        name: defaultName,
        description: 'No description provided.',
      };

      if (content.startsWith('---')) {
        const parts = content.split('---');
        if (parts[1]) {
          try {
            const parsed = yaml.parse(parts[1]);
            if (parsed && typeof parsed === 'object') {
              meta.name = parsed.name || meta.name;
              meta.description = parsed.description || meta.description;
            }
          } catch {}
        }
      }

      if (meta.description === 'No description provided.') {
        const firstH1 = content
          .split('\n')
          .find((line) => line.startsWith('# '));
        if (firstH1) {
          meta.description = firstH1.substring(2).trim();
        }
      }

      return meta;
    } catch {
      return { name: defaultName, description: 'No description provided.' };
    }
  }

  private async handleSession(args?: string): Promise<void> {
    const sessionMgr = new SessionManager(this.projectPath);
    const cleanedArgs = args?.trim();

    if (!cleanedArgs) {
      const sessions = sessionMgr.list();
      const current = sessionMgr.currentName();

      if (sessions.length === 0) {
        console.log('  No sessions found.');
        return;
      }

      const options = sessions.map((s) => ({
        value: s.name,
        label: s.name,
        hint: s.name === current ? '(current)' : `${s.event_count || 0} events`,
      }));

      options.push({
        value: '__new__',
        label: '+ Create a new session...',
        hint: '',
      });

      options.push({
        value: '__cancel__',
        label: 'Cancel',
        hint: '',
      });

      const chosen = await UI.selectPrompt(
        'Select a conversation session:',
        options,
        current || undefined,
      );
      if (UI.isCancel(chosen) || chosen === '__cancel__') {
        return;
      }

      if (chosen === '__new__') {
        const name = `session_${new Date().toISOString().replace(/[-:T.Z]/g, '')}`;
        sessionMgr.create(name);
        sessionMgr.activate(name);
        UI.printSuccess(`Created and switched to session '${name}'`);
        if (this.onReload) {
          this.onReload();
        }
        return;
      }

      const sessionName = chosen as string;
      sessionMgr.activate(sessionName);
      UI.printSuccess(`Switched to session '${sessionName}'`);
      if (this.onReload) {
        this.onReload();
      }
      return;
    }

    if (cleanedArgs.toLowerCase() === 'list') {
      const sessions = sessionMgr.list();
      const current = sessionMgr.currentName();

      console.log('Aura Conversation Sessions:');
      console.log('-'.repeat(60));

      if (sessions.length === 0) {
        console.log('  No sessions found.');
        console.log('  Create one: aura session create <name>');
      } else {
        for (const s of sessions) {
          const activeStar = s.name === current ? '* ' : '  ';
          console.log(
            `${activeStar}${s.name.padEnd(30)} (${s.event_count || 0} events)`,
          );
        }
      }

      console.log('-'.repeat(60));
      console.log('Usage: /session <session_name>  - Switch session');
      console.log(
        '       /session new             - Start a new timestamped session',
      );
    } else {
      let name = cleanedArgs;
      if (name.toLowerCase() === 'new') {
        name = `session_${new Date().toISOString().replace(/[-:T.Z]/g, '')}`;
        if (!sessionMgr.exists(name)) {
          sessionMgr.create(name);
        }
      }

      if (!sessionMgr.exists(name)) {
        console.log(picocolors.red(`⛔️ Session '${name}' does not exist`));
        console.log('Create it first: /session new');
        return;
      }

      sessionMgr.activate(name);
      console.log(`🔄 Switching conversation session to '${name}'...`);

      if (this.onReload) {
        this.onReload();
        console.log(
          picocolors.green(
            `Successfully switched and hot-loaded session '${name}'!`,
          ),
        );
      } else {
        console.log(
          picocolors.yellow(
            'Session registered. Please restart agent shell to activate.',
          ),
        );
      }
    }
  }

  private handleUndo(): void {
    if (this.runner.undo()) {
      console.log('✅ Undid last turn.');
    } else {
      console.log('⚠️  Nothing to undo.');
    }
  }

  private handleRedo(): void {
    if (this.runner.redo()) {
      console.log('✅ Redid last turn.');
    } else {
      console.log('⚠️  Nothing to redo.');
    }
  }

  private async handleModel(args?: string): Promise<void> {
    const config = this.configLoader() as ShellConfig;
    if (!args || args.trim().length === 0) {
      const provider = config?.llm?.provider || 'local';
      const currentModel = config?.llm?.model || 'default';

      let models: { value: string; label: string; hint?: string }[] = [];
      if (provider === 'openai') {
        models = [
          { value: 'gpt-4o-mini', label: 'gpt-4o-mini', hint: 'Recommended' },
          { value: 'gpt-4o', label: 'gpt-4o' },
          { value: 'gpt-4-turbo', label: 'gpt-4-turbo' },
          { value: 'o1-mini', label: 'o1-mini' },
        ];
      } else if (provider === 'anthropic') {
        models = [
          {
            value: 'claude-3-5-haiku-latest',
            label: 'claude-3-5-haiku-latest',
            hint: 'Recommended',
          },
          {
            value: 'claude-3-5-sonnet-latest',
            label: 'claude-3-5-sonnet-latest',
          },
          { value: 'claude-3-opus-latest', label: 'claude-3-opus-latest' },
        ];
      } else if (provider === 'openrouter') {
        models = [
          {
            value: 'google/gemini-2.5-flash',
            label: 'google/gemini-2.5-flash',
            hint: 'Recommended',
          },
          {
            value: 'openai/gpt-4o-mini',
            label: 'openai/gpt-4o-mini',
          },
          {
            value: 'anthropic/claude-3.5-haiku',
            label: 'anthropic/claude-3.5-haiku',
          },
          {
            value: 'meta-llama/llama-3.3-70b-instruct',
            label: 'llama-3.3-70b',
          },
        ];
      } else if (provider === 'gemini') {
        models = [
          {
            value: 'gemini-2.5-flash',
            label: 'gemini-2.5-flash',
            hint: 'Recommended',
          },
          { value: 'gemini-1.5-flash', label: 'gemini-1.5-flash' },
          { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
        ];
      } else if (provider === 'deepseek') {
        models = [
          {
            value: 'deepseek-chat',
            label: 'deepseek-chat',
            hint: 'Recommended',
          },
          { value: 'deepseek-reasoner', label: 'deepseek-reasoner' },
        ];
      } else {
        models = [
          { value: 'llama3', label: 'llama3' },
          { value: 'mistral', label: 'mistral' },
          { value: 'phi3', label: 'phi3' },
        ];
      }

      models.push({
        value: '__custom__',
        label: 'Custom...',
        hint: 'Specify custom model name',
      });
      models.push({ value: '__cancel__', label: 'Cancel' });

      const chosen = await UI.selectPrompt(
        `Select a model for ${provider}:`,
        models,
        currentModel,
      );
      if (UI.isCancel(chosen) || chosen === '__cancel__') {
        return;
      }

      let modelName = chosen as string;
      if (chosen === '__custom__') {
        modelName = await UI.prompt('Enter custom model name: ');
        if (!modelName || modelName.trim().length === 0) return;
      }

      this.updateConfig('llm', 'model', modelName.trim());
      UI.printSuccess(`Model switched to: ${modelName.trim()}`);
    } else {
      this.updateConfig('llm', 'model', args.trim());
      UI.printSuccess(`Model switched to: ${args.trim()}`);
    }
  }

  private async handleProvider(args?: string): Promise<void> {
    const config = this.configLoader() as ShellConfig;
    if (!args || args.trim().length === 0) {
      const currentProvider = config?.llm?.provider || 'local';
      const providers = [
        { value: 'openai', label: 'OpenAI' },
        { value: 'anthropic', label: 'Anthropic' },
        { value: 'openrouter', label: 'OpenRouter' },
        { value: 'gemini', label: 'Gemini' },
        { value: 'deepseek', label: 'DeepSeek' },
        { value: 'local', label: 'Local (Ollama/LM Studio/etc.)' },
        { value: '__cancel__', label: 'Cancel' },
      ];

      const chosen = await UI.selectPrompt(
        'Select LLM provider:',
        providers,
        currentProvider,
      );
      if (UI.isCancel(chosen) || chosen === '__cancel__') {
        return;
      }

      const provider = chosen as string;
      this.updateConfig('llm', 'provider', provider);
      UI.printSuccess(`Provider switched to: ${provider}`);
      if (this.onReload) {
        this.onReload();
      }
    } else {
      const provider = args.trim();
      this.updateConfig('llm', 'provider', provider);
      UI.printSuccess(`Provider switched to: ${provider}`);
      if (this.onReload) {
        this.onReload();
      }
    }
  }

  private handleSettings(): void {
    const config = this.configLoader() as ShellConfig;
    const sessionMgr = new SessionManager(this.projectPath);
    const currentSession = sessionMgr.currentName() || 'default';
    const provider = config?.llm?.provider || 'local';
    const model = config?.llm?.model || 'default';

    Env.loadFrom(this.projectPath);
    let apiKey: string | null = config?.llm?.api_key || null;
    if (!apiKey && config?.llm?.api_key_env) {
      apiKey = process.env[config.llm.api_key_env] ?? null;
    }
    if (!apiKey) {
      apiKey = Env.resolveApiKey(provider) ?? null;
    }

    const cfgPath = PathResolver.resolveConfigPath(this.projectPath) || '';

    let maskedKey = picocolors.red('Missing');
    if (apiKey && apiKey.trim().length > 0) {
      const trimmed = apiKey.trim();
      if (trimmed.length <= 8) {
        maskedKey = `${picocolors.green('Present')} (masked: ****)`;
      } else {
        maskedKey =
          picocolors.green('Present') +
          ` (masked: ${trimmed.substring(0, 4)}...${trimmed.substring(trimmed.length - 4)})`;
      }
    }

    const sessionInfo = sessionMgr
      .list()
      .find((s) => s.name === currentSession);
    const eventCount = sessionInfo?.event_count || 0;

    console.log('Current Workspace Settings:');
    console.log(
      `  Active Session:  ${picocolors.yellow(currentSession)} (${eventCount} events)`,
    );
    console.log(`  LLM Provider:    ${picocolors.yellow(provider)}`);
    console.log(`  LLM Model:       ${picocolors.yellow(model)}`);
    console.log(`  API Key:         ${maskedKey}`);
    console.log(`  Config File:     ${cfgPath}`);
  }

  private handleHelp(): void {
    console.log('Available commands:');
    console.log('  /model <name>    - Switch LLM model');
    console.log('  /provider <name> - Switch LLM provider');
    console.log('  /settings        - Show current session and LLM settings');
    console.log('  /undo            - Undo last turn (removes from memory)');
    console.log('  /redo            - Redo last undone turn');
    console.log(
      '  /session [name]  - List, switch, or create new conversation sessions',
    );
    console.log(
      '  /context         - Compile and print current project context',
    );
    console.log('  /tools           - List all registered tools in workspace');
    console.log('  /skills          - List all available agent skills');
    console.log('  /help            - Show this help');
    console.log('  /auto on/off     - Toggle auto mode');
    console.log('  /exit or /quit   - Exit the shell');
  }

  private handleAuto(args: string): void {
    const cleanedArgs = args.trim().toLowerCase();
    if (cleanedArgs === 'on') {
      this.runner.toggleAuto(true);
      console.log('✅ Auto mode enabled.');
    } else if (cleanedArgs === 'off') {
      this.runner.toggleAuto(false);
      console.log('✅ Auto mode disabled.');
    } else {
      console.log('Usage: /auto on|off');
    }
  }

  private updateConfig(section: string, key: string, value: unknown): void {
    const cfgPath = PathResolver.resolveConfigPath(this.projectPath);
    if (!cfgPath) return;

    let data: Record<string, unknown> = {};
    if (fs.existsSync(cfgPath)) {
      try {
        const parsed = yaml.parse(fs.readFileSync(cfgPath, 'utf-8'));
        data =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
      } catch {}
    }

    const sectionData =
      data[section] && typeof data[section] === 'object'
        ? (data[section] as Record<string, unknown>)
        : {};
    sectionData[key] = value;
    data[section] = sectionData;
    fs.writeFileSync(cfgPath, yaml.stringify(data), 'utf-8');
  }
}

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { fileURLToPath } from 'node:url';
import { Runner } from '../../core/kernel/runner.js';
import { SessionManager } from '../../core/memory/sessionManager.js';
import { ContextAssembler } from '../../core/context/assembler.js';
import { ToolRegistry } from '../../core/kernel/registry.js';
import * as PathResolver from '../../utils/pathResolver.js';
import { ConfigManager } from '../../utils/configManager.js';
import * as Env from '../../core/llm/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class SlashCommandManager {
  private projectPath: string;
  private configLoader: () => any;
  private runner: Runner;
  private onReload?: () => void;

  constructor(projectPath: string, configLoader: () => any, runner: Runner, options: { onReload?: () => void } = {}) {
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
        this.handleModel(args);
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
      default:
        console.log(`Unknown command: ${cmd}`);
        break;
    }

    return true;
  }

  private handleContext(): void {
    const root = path.resolve(this.projectPath);
    const out = ContextAssembler.assemble(root, this.runner.memory);
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
        const desc = toolData?.manifest?.description || 'No description provided.';
        console.log(`  * ${name.padEnd(25)} - ${desc}`);
      }
    }
  }

  private handleSkills(): void {
    const skillsDir = path.join(this.projectPath, 'skills');
    
    // Resolve templates/skills directory
    let templateSkillsDir = path.resolve(__dirname, '..', '..', 'generators', 'aura', 'app', 'templates', 'skills');
    if (!fs.existsSync(templateSkillsDir)) {
      templateSkillsDir = path.resolve(__dirname, '..', '..', 'src', 'generators', 'aura', 'app', 'templates', 'skills');
    }

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
        } catch (e) {}
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

  private parseSkillMeta(filePath: string, defaultName: string): { name: string; description: string } {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const meta = { name: defaultName, description: 'No description provided.' };

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
        const firstH1 = content.split('\n').find(line => line.startsWith('# '));
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

    if (!cleanedArgs || cleanedArgs.toLowerCase() === 'list') {
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
          console.log(`${activeStar}${s.name.padEnd(30)} (${s.event_count || 0} events)`);
        }
      }

      console.log('-'.repeat(60));
      console.log('Usage: /session <session_name>  - Switch session');
      console.log('       /session new             - Start a new timestamped session');
    } else {
      let name = cleanedArgs;
      if (name.toLowerCase() === 'new') {
        name = `session_${new Date().toISOString().replace(/[-:T.Z]/g, '')}`;
        if (!sessionMgr.exists(name)) {
          sessionMgr.create(name);
        }
      }

      if (!sessionMgr.exists(name)) {
        console.log(`\x1b[31m⛔️ Session '${name}' does not exist\x1b[0m`);
        console.log('Create it first: /session new');
        return;
      }

      sessionMgr.activate(name);
      console.log(`🔄 Switching conversation session to '${name}'...`);

      if (this.onReload) {
        this.onReload();
        console.log(`\x1b[32mSuccessfully switched and hot-loaded session '${name}'!\x1b[0m`);
      } else {
        console.log('\x1b[33mSession registered. Please restart chat shell to activate.\x1b[0m');
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

  private handleModel(args?: string): void {
    const config = this.configLoader();
    if (!args || args.trim().length === 0) {
      console.log(`Current model: ${config?.llm?.model || 'default'}`);
      console.log('Usage: /model <model_name>');
    } else {
      this.updateConfig('llm', 'model', args.trim());
      console.log(`Model switched to: ${args.trim()}`);
    }
  }

  private async handleProvider(args?: string): Promise<void> {
    const config = this.configLoader();
    if (!args || args.trim().length === 0) {
      console.log(`Current provider: ${config?.llm?.provider || 'local'}`);
      console.log('Usage: /provider <provider_name>');
    } else {
      const provider = args.trim();
      this.updateConfig('llm', 'provider', provider);
      console.log(`Provider switched to: ${provider}`);
      if (this.onReload) {
        this.onReload();
      }
    }
  }

  private handleSettings(): void {
    const config = this.configLoader();
    const sessionMgr = new SessionManager(this.projectPath);
    const currentSession = sessionMgr.currentName() || 'default';
    const provider = config?.llm?.provider || 'local';
    const model = config?.llm?.model || 'default';

    Env.loadFrom(this.projectPath);
    let apiKey = config?.llm?.api_key || null;
    if (!apiKey && config?.llm?.api_key_env) {
      apiKey = process.env[config.llm.api_key_env] || null;
    }
    if (!apiKey) {
      apiKey = Env.resolveApiKey(provider);
    }

    const cfgPath = PathResolver.resolveConfigPath(this.projectPath) || '';
    
    let maskedKey = '\x1b[31mMissing\x1b[0m';
    if (apiKey && apiKey.trim().length > 0) {
      const trimmed = apiKey.trim();
      if (trimmed.length <= 8) {
        maskedKey = '\x1b[32mPresent\x1b[0m (masked: ****)';
      } else {
        maskedKey = `\x1b[32mPresent\x1b[0m (masked: ${trimmed.substring(0, 4)}...${trimmed.substring(trimmed.length - 4)})`;
      }
    }

    const sessionInfo = sessionMgr.list().find(s => s.name === currentSession);
    const eventCount = sessionInfo?.event_count || 0;

    console.log('Current Workspace Settings:');
    console.log(`  Active Session:  \x1b[33m${currentSession}\x1b[0m (${eventCount} events)`);
    console.log(`  LLM Provider:    \x1b[33m${provider}\x1b[0m`);
    console.log(`  LLM Model:       \x1b[33m${model}\x1b[0m`);
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
    console.log('  /session [name]  - List, switch, or create new conversation sessions');
    console.log('  /context         - Compile and print current project context');
    console.log('  /tools           - List all registered tools in workspace');
    console.log('  /skills          - List all available agent skills');
    console.log('  /help            - Show this help');
    console.log('  /auto on/off     - Toggle auto mode');
    console.log('  /exit or /quit   - Exit the shell');
  }

  private updateConfig(section: string, key: string, value: any): void {
    const cfgPath = PathResolver.resolveConfigPath(this.projectPath);
    if (!cfgPath) return;

    let data: any = {};
    if (fs.existsSync(cfgPath)) {
      try {
        data = yaml.parse(fs.readFileSync(cfgPath, 'utf-8')) || {};
      } catch {}
    }

    data[section] = data[section] || {};
    data[section][key] = value;
    fs.writeFileSync(cfgPath, yaml.stringify(data), 'utf-8');
  }
}

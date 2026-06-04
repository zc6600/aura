#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import picocolors from 'picocolors';
import { VERSION } from '../index.js';
import { Runner } from '../core/kernel/runner.js';

// Subcommand imports
import { Doctor } from '../cli/commands/doctor.js';
import { Info } from '../cli/commands/info.js';
import { Config } from '../cli/commands/config.js';
import { Project } from '../cli/commands/project.js';
import { Git } from '../cli/commands/git.js';
import { Branch } from '../cli/commands/branch.js';
import { Skills } from '../cli/commands/skills.js';
import { Tools } from '../cli/commands/tools.js';
import { Kernel } from '../cli/commands/kernel.js';
import { SessionCmd } from '../cli/commands/session.js';
import { Hints } from '../cli/commands/hints.js';
import { Ask } from '../cli/commands/ask.js';
import { Garden } from '../cli/commands/garden.js';
import { Template } from '../cli/commands/template.js';
import { Update } from '../cli/commands/update.js';
import { Session } from '../cli/shell/session.js';
import { WebServer } from '../cli/shell/webServer.js';
import { initializeWorkspaceInPlace } from '../utils/workspaceInitializer.js';
import * as PathResolver from '../utils/pathResolver.js';

const program = new Command();

program
  .name('aura')
  .description('AI-native operating system for folder-as-workspace agents')
  .version(VERSION);

// Root block guard
function checkRootGuard(commandName: string): void {
  if (process.env.AURA_ALLOW_ROOT === 'true') {
    return;
  }
  const hasGemspec = fs.existsSync('aura.gemspec') || fs.existsSync('package.json');
  if (hasGemspec) {
    const isAuraPkg = fs.existsSync('package.json') && 
                      JSON.parse(fs.readFileSync('package.json', 'utf-8')).name === 'aura-cli';
    
    if (isAuraPkg) {
      const exempted = ['help', 'version', 'new', 'doctor', 'info', 'list', 'delete', 'register', 'prune', 'web', 'template', 'completion'];
      if (!exempted.includes(commandName)) {
        console.error(picocolors.red('⛔️ You are trying to run Aura from the source root directory.'));
        console.log('Please run it in a separate workspace directory (e.g., run `aura new my_project` first).');
        process.exit(1);
      }
    }
  }
}

// 1. Version Command
program
  .command('version')
  .description('Show Aura version')
  .action(() => {
    console.log(`Aura OS version: ${picocolors.cyan(VERSION)}`);
  });

function completionZsh(): string {
  return [
    '#compdef aura',
    '',
    '_aura() {',
    '  local state',
    '  _arguments -C \\',
    '    "1: :->cmds" \\',
    '    "*: :->args"',
    '',
    '  case "$state" in',
    '    cmds)',
    '      _values "aura command" \\',
    '        "add[Stage files inside the local Aura environment]" \\',
    '        "ask[Directly ask the LLM a question, or start an interactive pure chat loop]" \\',
    '        "branch[List, switch, or create customized agent profiles]" \\',
    '        "chat[Start an interactive Aura chat session]" \\',
    '        "commit[Commit staged changes inside the local Aura environment]" \\',
    '        "completion[Generate shell autocompletion script (bash or zsh)]" \\',
    '        "config[Read or write configuration settings]" \\',
    '        "context[Compile and print project context]" \\',
    '        "delete[Unregister an Aura project and delete its .aura sandbox]" \\',
    '        "doctor[Run environment checks]" \\',
    '        "garden[Manage playbooks and environment scaffolding (gardens)]" \\',
    '        "hints[Manage context/magic hint injection configurations]" \\',
    '        "info[Display comprehensive system and workspace information]" \\',
    '        "kernel[Kernel commands]" \\',
    '        "list[List all globally registered Aura projects]" \\',
    '        "new[Initialize an Aura environment at the specified path]" \\',
    '        "prune[Remove all registered projects whose directories no longer exist]" \\',
    '        "pull[Pull new templates or updates from the global repository]" \\',
    '        "register[Register the current directory as an Aura project]" \\',
    '        "session[Manage conversation sessions]" \\',
    '        "skill[Manage agent skills in the active workspace]" \\',
    '        "status[Show what files are modified or untracked inside .aura]" \\',
    '        "sync[Push local workspace changes back to the global template repository]" \\',
    '        "template[Template management and sync]" \\',
    '        "tools[Tools management commands]" \\',
    '        "update[Update framework, templates, and sub-projects]" \\',
    '        "version[Show Aura version]" \\',
    '        "web[Start a lightweight Aura web server (events JSON & SSE)]" \\',
    '        "h[Alias: hints list]" \\',
    '        "t[Alias: tools list]" \\',
    '        "s[Alias: skill list]" \\',
    '        "k[Alias: kernel observe]" \\',
    '        "c[Alias: chat]" \\',
    '        "v[Alias: version]"',
    '      ;;',
    '    args)',
    '      case "$words[1]" in',
    '        tools|t)',
    '          _values "tools subcommand" \\',
    '            "list[List all tools]" \\',
    '            "inspect[Inspect a tool by name]" \\',
    '            "generate_group[Generate a hierarchical tool group]" \\',
    '            "add[Install a library tool by name or URL/path]" \\',
    '            "install[Install a tool from a Git URL or local directory]"',
    '          ;;',
    '        kernel|k)',
    '          _values "kernel subcommand" \\',
    '            "observe[Observe current environment and assemble context]" \\',
    '            "run_call[Run a specific tool call]" \\',
    '            "once[Run Kernel once with a provided call payload]" \\',
    '            "plan[Run planner to produce next step]" \\',
    '            "loop[Loop planner and tool calls until final]"',
    '          ;;',
    '        skill|s)',
    '          _values "skill subcommand" \\',
    '            "list[List all skills and their status]" \\',
    '            "install[Install a skill from a Git URL or local directory]"',
    '          ;;',
    '        hints|h)',
    '          _values "hints subcommand" \\',
    '            "list[List all files parsed for hint injection and their status]" \\',
    '            "toggle[Toggle hint injection status for a file]" \\',
    '            "global[Show global operational guidance file]"',
    '          ;;',
    '        session)',
    '          _values "session subcommand" \\',
    '            "list[List all sessions]" \\',
    '            "create[Create a new session]" \\',
    '            "switch[Switch to a session]" \\',
    '            "delete[Delete a session]" \\',
    '            "duplicate[Duplicate a session]" \\',
    '            "export[Export a session]" \\',
    '            "import[Import a session]" \\',
    '            "rename[Rename a session]" \\',
    '            "current[Show the current active session]"',
    '          ;;',
    '        update)',
    '          _values "update subcommand" \\',
    '            "framework[Update Aura framework]" \\',
    '            "status[Check template update status]" \\',
    '            "all[Update all sub-projects]" \\',
    '            "project[Update a single project]" \\',
    '            "current[Update current workspace templates]" \\',
    '            "merge[Merge template updates]"',
    '          ;;',
    '        template)',
    '          _values "template subcommand" \\',
    '            "sync[Sync template updates from Aura framework to global repo]" \\',
    '            "status[Check template version and sync status]" \\',
    '            "diff[Show differences between framework templates and global repo]"',
    '          ;;',
    '        garden)',
    '          _values "garden subcommand" \\',
    '            "list[List all available Garden Playbooks]" \\',
    '            "status[Show workspace health and metrics]" \\',
    '            "init[Initialize a Garden Playbook template]"',
    '          ;;',
    '      esac',
    '      ;;',
    '  esac',
    '}',
    '',
    'compdef _aura aura',
    '',
  ].join('\n');
}

function completionBash(): string {
  const commands = [
    'add',
    'ask',
    'branch',
    'chat',
    'commit',
    'completion',
    'config',
    'context',
    'delete',
    'doctor',
    'garden',
    'hints',
    'info',
    'kernel',
    'list',
    'new',
    'prune',
    'pull',
    'register',
    'session',
    'skill',
    'status',
    'sync',
    'template',
    'tools',
    'update',
    'version',
    'web',
    'h',
    't',
    's',
    'k',
    'c',
    'v',
  ].join(' ');

  return [
    '_aura() {',
    '  local cur prev',
    '  COMPREPLY=()',
    '  cur="${COMP_WORDS[COMP_CWORD]}"',
    '  prev="${COMP_WORDS[COMP_CWORD-1]}"',
    '',
    `  commands="${commands}"`,
    '',
    '  if [ $COMP_CWORD -eq 1 ]; then',
    '    COMPREPLY=( $(compgen -W "${commands}" -- ${cur}) )',
    '    return 0',
    '  fi',
    '',
    '  case "${COMP_WORDS[1]}" in',
    '    hints|h)',
    '      COMPREPLY=( $(compgen -W "list toggle global" -- ${cur}) )',
    '      return 0',
    '      ;;',
    '    tools|t)',
    '      COMPREPLY=( $(compgen -W "list inspect generate_group add install" -- ${cur}) )',
    '      return 0',
    '      ;;',
    '    kernel|k)',
    '      COMPREPLY=( $(compgen -W "observe run_call once plan loop" -- ${cur}) )',
    '      return 0',
    '      ;;',
    '    skill|s)',
    '      COMPREPLY=( $(compgen -W "list install" -- ${cur}) )',
    '      return 0',
    '      ;;',
    '    session)',
    '      COMPREPLY=( $(compgen -W "list create switch delete duplicate export import rename current" -- ${cur}) )',
    '      return 0',
    '      ;;',
    '    update)',
    '      COMPREPLY=( $(compgen -W "framework status all project current merge" -- ${cur}) )',
    '      return 0',
    '      ;;',
    '    template)',
    '      COMPREPLY=( $(compgen -W "sync status diff" -- ${cur}) )',
    '      return 0',
    '      ;;',
    '    garden)',
    '      COMPREPLY=( $(compgen -W "list status init" -- ${cur}) )',
    '      return 0',
    '      ;;',
    '  esac',
    '}',
    'complete -F _aura aura',
    '',
  ].join('\n');
}

program
  .command('completion [shell]')
  .description('Generate shell autocompletion script (bash or zsh)')
  .action((shell) => {
    const resolved = (shell ? shell : ((process.env.SHELL || '').includes('zsh') ? 'zsh' : 'bash')).toString().toLowerCase();
    if (resolved === 'zsh') {
      console.log(completionZsh());
    } else {
      console.log(completionBash());
    }
  });

// 2. New Command
program
  .command('new [path]')
  .description('Initialize an Aura environment at the specified path (defaults to current directory)')
  .action(async (targetPath) => {
    const p = targetPath || '.';
    await initializeWorkspaceInPlace(p);
  });

// 3. Doctor Command
program
  .command('doctor')
  .description('Run environment checks')
  .option('-p, --prompts', 'Validate prompt templates and synchronization')
  .action(async (options) => {
    checkRootGuard('doctor');
    await Doctor.run(options);
  });

// 4. Info Command
program
  .command('info')
  .description('Display comprehensive system and workspace information')
  .action(async () => {
    checkRootGuard('info');
    await Info.run();
  });

// 5. Config Command
program
  .command('config [key] [value]')
  .description('Read or write configuration settings')
  .option('-g, --global', 'Target the global template repository config')
  .action(async (key, value, options) => {
    checkRootGuard('config');
    await Config.run(key, value, options);
  });

// 6. Branch Command
program
  .command('branch [profile_name]')
  .description('List, switch, or create customized agent profiles')
  .action(async (profileName) => {
    checkRootGuard('branch');
    await Branch.run(profileName);
  });

// Project commands directly mapped
program
  .command('list')
  .description('List all globally registered Aura projects')
  .action(() => {
    checkRootGuard('list');
    Project.list();
  });

program
  .command('delete <project_name>')
  .description('Unregister an Aura project and delete its .aura sandbox')
  .action(async (projectName) => {
    checkRootGuard('delete');
    await Project.delete(projectName);
  });

program
  .command('register <project_name>')
  .description('Register the current directory as an Aura project')
  .action((projectName) => {
    checkRootGuard('register');
    Project.register(projectName);
  });

program
  .command('prune')
  .description('Remove all registered projects whose directories no longer exist')
  .action(() => {
    checkRootGuard('prune');
    Project.prune();
  });

// 7. Context Command
program
  .command('context [project_path]')
  .description('Compile and print project context')
  .action(async (projectPath) => {
    checkRootGuard('context');
    const root = projectPath ? path.resolve(projectPath) : process.cwd();
    const runner = new Runner(root);
    try {
      const ctx = await runner.observe();
      console.log(String(ctx));
    } catch (e: any) {
      console.error(picocolors.red(`Error resolving context: ${e.message}`));
    }
  });

// 8. Chat Command
program
  .command('chat [project_path]')
  .description('Start an interactive Aura chat session')
  .option('-v, --verbose', 'Show detailed output')
  .option('-g, --goal <goal>', 'Autonomous goal to execute without interactive input (exits when complete)')
  .option('--ni, --non-interactive', 'Run non-interactively (requires --goal); final answer is printed to stdout', false)
  .option('--mode <mode>', 'Run loop mode: classic or ralph', 'classic')
  .option('--verify <command>', 'Verify test command for Ralph Loop')
  .option('--critic', 'Use Critic LLM instead of test command for Ralph Loop', false)
  .option('--critic_mode <critic_mode>', 'Critic mode: light or heavy', 'light')
  .option('--max_steps <max_steps>', 'Maximum steps/calls in Ralph Loop', (val) => parseInt(val, 10))
  .action(async (projectPath, options) => {
    checkRootGuard('chat');
    const root = projectPath ? path.resolve(projectPath) : process.cwd();
    let steps = options.max_steps;
    if (steps !== undefined) {
      try {
        steps = PathResolver.validateMaxSteps(steps);
      } catch (e: any) {
        console.error(picocolors.red(`⛔️ Error: ${e.message}`));
        process.exit(1);
      }
    }
    options.max_steps = steps;
    const session = new Session(root, options);
    await session.start();
  });

// 9. Web Command
program
  .command('web [project_path]')
  .description('Start a lightweight Aura web server (events JSON & SSE)')
  .option('-p, --port <port>', 'Port to bind', (val) => parseInt(val, 10), 9299)
  .option('-h, --host <host>', 'Host address', '127.0.0.1')
  .action((projectPath, options) => {
    checkRootGuard('web');
    const root = projectPath ? path.resolve(projectPath) : process.cwd();
    let port = options.port;
    try {
      port = PathResolver.validatePort(port);
    } catch (e: any) {
      console.error(picocolors.red(`⛔️ Error: ${e.message}`));
      process.exit(1);
    }

    const server = new WebServer(root, port, options.host);
    server.start();
  });

// --- Git VCS commands ---
program
  .command('add <paths...>')
  .description('Stage files inside the local Aura environment')
  .action(async (paths) => {
    checkRootGuard('add');
    await Git.add(paths);
  });

program
  .command('commit')
  .description('Commit staged changes inside the local Aura environment')
  .requiredOption('-m, --message <message>', 'Commit message')
  .action(async (options) => {
    checkRootGuard('commit');
    await Git.commit(options.message);
  });

program
  .command('sync')
  .description('Push local workspace changes back to the global template repository')
  .action(async () => {
    checkRootGuard('sync');
    await Git.sync();
  });

program
  .command('pull')
  .description('Pull new templates or updates from the global repository')
  .action(async () => {
    checkRootGuard('pull');
    await Git.pull();
  });

program
  .command('status')
  .description('Show what files are modified or untracked inside .aura')
  .action(async () => {
    checkRootGuard('status');
    await Git.status();
  });

// 10. Ask Command
program
  .command('ask [question]')
  .description('Directly ask the LLM a question, or start an interactive pure chat loop if no question is provided')
  .option('--model <model>', 'Override model name')
  .option('--provider <provider>', 'Override provider name (local, openai, openrouter)')
  .option('--system <system>', 'System prompt instructions')
  .option('-s, --session <session>', 'Session name for memory', 'default')
  .option('-c, --clear', 'Clear session memory before asking')
  .action(async (question, options) => {
    checkRootGuard('ask');
    await Ask.run(question, options);
  });

// --- SUBCOMMANDS ---

// Tools subcommand
const toolsCmd = program.command('tools').description('Tools management commands');
toolsCmd
  .command('list [project_path]')
  .description('List all tools')
  .option('-H, --human', 'Human-readable output')
  .action((projectPath, options) => {
    checkRootGuard('tools');
    Tools.list(projectPath, options);
  });
toolsCmd
  .command('inspect <name>')
  .description('Inspect a tool by name and print structured metadata')
  .option('-p, --pretty', 'Pretty-print JSON output')
  .option('-H, --human', 'Human-readable summary')
  .action(async (name, options) => {
    checkRootGuard('tools');
    await Tools.inspect(name, options);
  });
toolsCmd
  .command('generate_group <name> [subtools...]')
  .description('Generate a hierarchical tool group')
  .action((name, subtools) => {
    checkRootGuard('tools');
    Tools.generateGroup(name, subtools || []);
  });
toolsCmd
  .command('add <tool_name_or_url>')
  .description('Install a library tool by name, or from a Git URL/local directory')
  .action(async (toolNameOrUrl) => {
    checkRootGuard('tools');
    await Tools.add(toolNameOrUrl);
  });
toolsCmd
  .command('install <url_or_path> [name]')
  .description('Install a tool from a Git URL or local directory')
  .action(async (urlOrPath, name) => {
    checkRootGuard('tools');
    await Tools.install(urlOrPath, name);
  });

// Kernel subcommand
const kernelCmd = program.command('kernel').description('Kernel commands');
kernelCmd
  .command('observe [project_path]')
  .description('Observe current environment and assemble context')
  .option('-H, --human', 'Human-readable output')
  .option('-n, --preview-lines <lines>', 'Lines to show in context preview', (val) => parseInt(val, 10), 5)
  .action(async (projectPath, options) => {
    checkRootGuard('kernel');
    await Kernel.observe(projectPath, options);
  });
kernelCmd
  .command('run_call <tool> <args_json> [project_path]')
  .description('Run a specific tool call')
  .action(async (tool, argsJson, projectPath) => {
    checkRootGuard('kernel');
    await Kernel.runCall(tool, argsJson, projectPath);
  });
kernelCmd
  .command('once [project_path]')
  .description('Run Kernel once with a provided call payload')
  .option('-c, --call <call>', 'JSON payload: {"tool":..., "args":{...}}')
  .option('-i, --input <input>', 'User input to plan a single call when no payload is provided')
  .option('-a, --ask', 'Prompt for user input if not provided')
  .option('-H, --human', 'Human-readable output')
  .option('-v, --verbose', 'Show detailed output')
  .option('-n, --preview-lines <lines>', 'Lines to show in context preview', (val) => parseInt(val, 10), 5)
  .action(async (projectPath, options) => {
    checkRootGuard('kernel');
    await Kernel.once(projectPath, options);
  });
kernelCmd
  .command('plan [project_path]')
  .description('Run planner to produce next step')
  .option('-g, --goal <goal>', 'Goal text to guide planning')
  .option('-H, --human', 'Human-readable output')
  .option('-n, --preview-lines <lines>', 'Lines to show in context preview', (val) => parseInt(val, 10), 5)
  .action(async (projectPath, options) => {
    checkRootGuard('kernel');
    await Kernel.plan(projectPath, options);
  });
kernelCmd
  .command('loop [project_path]')
  .description('Loop planner and tool calls until final')
  .option('-g, --goal <goal>', 'Goal text to guide planning')
  .option('-H, --human', 'Human-readable output')
  .option('-v, --verbose', 'Show detailed output')
  .option('-m, --max-steps <steps>', 'Maximum loop steps', (val) => parseInt(val, 10), 30)
  .action(async (projectPath, options) => {
    checkRootGuard('kernel');
    await Kernel.loop(projectPath, options);
  });

// Skill subcommand
const skillCmd = program.command('skill').description('Manage agent skills in the active workspace');
skillCmd
  .command('list [project_path]')
  .description('List all skills and their status in the active workspace')
  .option('-j, --json', 'Output in JSON format')
  .action(async (projectPath, options) => {
    checkRootGuard('skill');
    await Skills.list(projectPath, options);
  });
skillCmd
  .command('install <url_or_path> [name]')
  .description('Install a skill from a Git URL or local directory')
  .action(async (urlOrPath, name) => {
    checkRootGuard('skill');
    await Skills.install(urlOrPath, name);
  });

// Hints subcommand
const hintsCmd = program.command('hints').description('Manage context/magic hint injection configurations');
hintsCmd
  .command('list [project_path]')
  .description('List all files parsed for hint injection and their status')
  .action((projectPath) => {
    checkRootGuard('hints');
    Hints.list(projectPath);
  });
hintsCmd
  .command('toggle <file_path> [project_path]')
  .description('Toggle hint injection status for a specific file')
  .action((filePath, projectPath) => {
    checkRootGuard('hints');
    Hints.toggle(filePath, projectPath);
  });
hintsCmd
  .command('global')
  .description('Display the path and contents of the global operational guidance file')
  .action(() => {
    checkRootGuard('hints');
    Hints.global();
  });

// Session subcommand
const sessionCmd = program.command('session').description('Manage conversation sessions');
sessionCmd
  .command('list')
  .description('List all sessions')
  .option('-j, --json', 'Output in JSON format')
  .action((options) => {
    checkRootGuard('session');
    SessionCmd.list(options);
  });
sessionCmd
  .command('create <name>')
  .description('Create a new session')
  .action((name) => {
    checkRootGuard('session');
    SessionCmd.create(name);
  });
sessionCmd
  .command('switch <name>')
  .description('Switch to a session')
  .action((name) => {
    checkRootGuard('session');
    SessionCmd.switchSession(name);
  });
sessionCmd
  .command('delete <name>')
  .description('Delete a session')
  .action(async (name) => {
    checkRootGuard('session');
    await SessionCmd.deleteSession(name);
  });
sessionCmd
  .command('duplicate <source> <name>')
  .description('Duplicate a session (for branching experiments)')
  .action((source, name) => {
    checkRootGuard('session');
    SessionCmd.duplicate(source, name);
  });
sessionCmd
  .command('export <name> <dest_path>')
  .description('Export a session to a backup file')
  .action((name, destPath) => {
    checkRootGuard('session');
    SessionCmd.exportSession(name, destPath);
  });
sessionCmd
  .command('import <path> <name>')
  .description('Import a session from a backup file')
  .action((sourcePath, name) => {
    checkRootGuard('session');
    SessionCmd.importSession(sourcePath, name);
  });
sessionCmd
  .command('rename <old_name> <new_name>')
  .description('Rename a session')
  .action((oldName, newName) => {
    checkRootGuard('session');
    SessionCmd.rename(oldName, newName);
  });
sessionCmd
  .command('current')
  .description('Show the current active session')
  .action(() => {
    checkRootGuard('session');
    SessionCmd.current();
  });

// Update subcommand
const updateCmd = program.command('update').description('Update framework, templates, and sub-projects');
updateCmd
  .command('framework')
  .description('Update Aura framework')
  .option('-f, --force', 'Force rebuild and bypass caches')
  .action(async (options) => {
    checkRootGuard('update');
    await Update.framework(options);
  });
updateCmd
  .command('status')
  .description('Check template update status for current project')
  .action(async () => {
    checkRootGuard('update');
    await Update.status();
  });
updateCmd
  .command('all')
  .description('Update all sub-projects with latest templates')
  .option('-m, --merge', 'Use merge instead of pull')
  .action(async (options) => {
    checkRootGuard('update');
    await Update.all(options);
  });
updateCmd
  .command('project <path_or_name>')
  .description('Update a single project by path or name')
  .option('-m, --merge', 'Use merge instead of pull')
  .action(async (pathOrName, options) => {
    checkRootGuard('update');
    await Update.project(pathOrName, options);
  });
updateCmd
  .command('current')
  .description('Update current workspace templates (alias: aura update .)')
  .option('-m, --merge', 'Use merge instead of pull')
  .action(async (options) => {
    checkRootGuard('update');
    await Update.current(options);
  });
updateCmd
  .command('merge')
  .description('Merge template updates from global repo with conflict resolution')
  .option('-s, --stash', 'Stash local changes before merge')
  .option('-f, --force', 'Force merge using theirs strategy')
  .action(async (options) => {
    checkRootGuard('update');
    await Update.merge(options);
  });

// Template subcommand
const templateCmd = program.command('template').description('Template management and sync');
templateCmd
  .command('sync')
  .description('Sync template updates from Aura framework to global repo')
  .action(async () => {
    checkRootGuard('template');
    await Template.sync();
  });
templateCmd
  .command('status')
  .description('Check template version and sync status')
  .action(async () => {
    checkRootGuard('template');
    await Template.status();
  });
templateCmd
  .command('diff')
  .description('Show differences between framework templates and global repo')
  .action(async () => {
    checkRootGuard('template');
    await Template.diff();
  });

// Garden subcommand
const gardenCmd = program.command('garden').description('Manage playbooks and environment scaffolding (gardens)');
gardenCmd
  .command('list [project_path]')
  .description('List all available Garden Playbooks')
  .action((projectPath) => {
    checkRootGuard('garden');
    Garden.list(projectPath);
  });
gardenCmd
  .command('status [project_path]')
  .description('Show the health and metrics of the current workspace')
  .action((projectPath) => {
    checkRootGuard('garden');
    Garden.status(projectPath);
  });
gardenCmd
  .command('init <playbook_name> [project_path]')
  .description('Initialize a Garden Playbook template in the current workspace')
  .action((playbookName, projectPath) => {
    checkRootGuard('garden');
    Garden.init(playbookName, projectPath);
  });

// Global alias maps matching Thor maps
const aliasMap: Record<string, string[]> = {
  h: ['hints', 'list'],
  t: ['tools', 'list'],
  s: ['skill', 'list'],
  k: ['kernel', 'observe'],
  c: ['chat'],
  v: ['version'],
};

const argv = process.argv;
const firstArg = argv[2];

if (firstArg && aliasMap[firstArg]) {
  argv.splice(2, 1, ...aliasMap[firstArg]);
}

program.parse(argv);

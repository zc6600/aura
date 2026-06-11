#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cli, Command, Option } from 'clipanion';
import picocolors from 'picocolors';
import { Branch } from '../cli/commands/branch.js';
import { Chat } from '../cli/commands/chat.js';
import { Config } from '../cli/commands/config.js';
// Subcommand imports
import { Doctor } from '../cli/commands/doctor.js';
import { Garden } from '../cli/commands/garden.js';
import { Git } from '../cli/commands/git.js';
import { Hints } from '../cli/commands/hints.js';
import { Info } from '../cli/commands/info.js';
import { Kernel } from '../cli/commands/kernel.js';
import { Project } from '../cli/commands/project.js';
import { SessionCmd } from '../cli/commands/session.js';
import { Skills } from '../cli/commands/skills.js';
import { Template } from '../cli/commands/template.js';
import { Tools } from '../cli/commands/tools.js';
import { Update } from '../cli/commands/update.js';
import { Session } from '../cli/shell/session.js';
import { WebServer } from '../cli/shell/webServer.js';
import * as UI from '../cli/ui.js';
import { Runner } from '../core/kernel/runner.js';
import { VERSION } from '../index.js';
import { completionBash, completionZsh } from '../cli/completion.js';
import * as PathResolver from '../utils/pathResolver.js';
import { initializeWorkspaceInPlace } from '../utils/workspaceInitializer.js';

// Root block guard
function checkRootGuard(commandName: string): void {
  if (
    process.env.AURA_ALLOW_ROOT === 'true' ||
    process.argv.includes('--allow-root')
  ) {
    return;
  }
  const hasGemspec =
    fs.existsSync('aura.gemspec') || fs.existsSync('package.json');
  if (hasGemspec) {
    let isAuraPkg = false;
    if (fs.existsSync('package.json')) {
      try {
        isAuraPkg =
          JSON.parse(fs.readFileSync('package.json', 'utf-8')).name === 'aura-cli';
      } catch {}
    }

    if (isAuraPkg) {
      const exempted = [
        'help',
        'version',
        'new',
        'doctor',
        'info',
        'list',
        'delete',
        'register',
        'prune',
        'web',
        'template',
        'completion',
        'chat',
        'branch',
        'config',
        'session',
      ];
      if (!exempted.includes(commandName)) {
        throw new UI.WorkspaceError(
          'You are trying to run Aura from the source root directory. Please run it in a separate workspace directory (e.g., run `aura new my_project` first).',
        );
      }
    }
  }
}


// ---------------------------------------------------------------------------
// Base Command with checkRootGuard
// ---------------------------------------------------------------------------
abstract class BaseCommand extends Command {
  async execute() {
    try {
      const cmdName = this.path[0];
      if (cmdName) {
        checkRootGuard(cmdName);
      }
      await this.run();
    } catch (e: unknown) {
      if (e instanceof UI.CliError) {
        UI.printError(e.message);
        if (e.tip) {
          console.log(picocolors.dim(`  Tip: ${e.tip}`));
        }
        process.exit(e.exitCode || 1);
      } else {
        console.error(
          picocolors.red(
            `⛔️ An unexpected error occurred: ${(e as Error).message}`,
          ),
        );
        if ((e as Error).stack && process.env.DEBUG) {
          console.error(picocolors.gray((e as Error).stack));
        }
        process.exit(1);
      }
    }
  }
  abstract run(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Custom Version & Help commands for strict test compatibility
// ---------------------------------------------------------------------------
class CustomVersionCommand extends Command {
  static paths = [[`-V`], [`--version`], [`version`]];

  async execute() {
    if (this.path[0] === 'version') {
      this.context.stdout.write(
        `Aura OS version: ${picocolors.cyan(VERSION)}\n`,
      );
    } else {
      this.context.stdout.write(`${VERSION}\n`);
    }
  }
}

class CustomHelpCommand extends Command {
  static paths = [[`-h`], [`--help`], [`help`], Command.Default];

  async execute() {
    this.context.stdout.write(
      `Usage:\n\n${this.cli.usage(null, { detailed: true })}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Command Classes
// ---------------------------------------------------------------------------

class CompletionCommand extends BaseCommand {
  static paths = [['completion']];
  static usage = Command.Usage({
    description: 'Generate shell autocompletion script (bash or zsh)',
  });
  shell = Option.String({ required: false });

  async run() {
    const resolved = (
      this.shell
        ? this.shell
        : (process.env.SHELL || '').includes('zsh')
          ? 'zsh'
          : 'bash'
    )
      .toString()
      .toLowerCase();
    if (resolved === 'zsh') {
      console.log(completionZsh(this.cli));
    } else {
      console.log(completionBash(this.cli));
    }
  }
}

class NewCommand extends BaseCommand {
  static paths = [['new']];
  static usage = Command.Usage({
    description: 'Initialize a new Aura workspace',
    details:
      'Creates a .aura-workspace/ directory in the target path and sets up the local agent environment.',
    examples: [
      ['Initialize in current directory', 'aura new .'],
      ['Initialize in a specific path', 'aura new ./my-project'],
    ],
  });
  targetPath = Option.String({ required: false });

  async run() {
    const p = this.targetPath || '.';
    await initializeWorkspaceInPlace(p);
  }
}

class DoctorCommand extends BaseCommand {
  static paths = [['doctor']];
  static usage = Command.Usage({
    description: 'Run environment health checks',
    details:
      'Verifies that all dependencies (Python, API keys, LLM connectivity) are correctly configured.',
    examples: [
      ['Run checks with interactive setup prompts', 'aura doctor --prompts'],
    ],
  });
  prompts = Option.Boolean('-p,--prompts', false);

  async run() {
    await Doctor.run({ prompts: this.prompts });
  }
}

class InfoCommand extends BaseCommand {
  static paths = [['info']];
  static usage = Command.Usage({
    description: 'Display comprehensive system and workspace information',
  });

  async run() {
    await Info.run();
  }
}

class ConfigCommand extends BaseCommand {
  static paths = [['config']];
  static usage = Command.Usage({
    description: 'Read or write configuration settings',
  });
  key = Option.String({ required: false });
  value = Option.String({ required: false });
  global = Option.Boolean('-g,--global', false);

  async run() {
    await Config.run(this.key, this.value, { global: this.global });
  }
}

class BranchCommand extends BaseCommand {
  static paths = [['branch']];
  static usage = Command.Usage({
    description: 'List, switch, or create customized agent profiles',
  });
  profileName = Option.String({ required: false });

  async run() {
    await Branch.run(this.profileName);
  }
}

class ListCommand extends BaseCommand {
  static paths = [['list']];
  static usage = Command.Usage({
    description: 'List all globally registered Aura projects',
  });

  async run() {
    Project.list();
  }
}

class DeleteCommand extends BaseCommand {
  static paths = [['delete']];
  static usage = Command.Usage({
    description: 'Unregister an Aura project and delete its .aura-workspace sandbox',
  });
  projectName = Option.String({ required: true });

  async run() {
    await Project.delete(this.projectName);
  }
}

class RegisterCommand extends BaseCommand {
  static paths = [['register']];
  static usage = Command.Usage({
    description: 'Register the current directory as an Aura project',
  });
  projectName = Option.String({ required: true });

  async run() {
    Project.register(this.projectName);
  }
}

class PruneCommand extends BaseCommand {
  static paths = [['prune']];
  static usage = Command.Usage({
    description:
      'Remove all registered projects whose directories no longer exist',
  });

  async run() {
    Project.prune();
  }
}

class ContextCommand extends BaseCommand {
  static paths = [['context']];
  static usage = Command.Usage({
    description: 'Compile and print project context',
  });
  projectPath = Option.String({ required: false });

  async run() {
    const root = this.projectPath
      ? path.resolve(this.projectPath)
      : process.cwd();
    const runner = new Runner(root);
    try {
      const ctx = await runner.observe();
      console.log(String(ctx));
    } catch (e: unknown) {
      console.error(
        picocolors.red(`Error resolving context: ${(e as Error).message}`),
      );
    }
  }
}

class AgentCommand extends BaseCommand {
  static paths = [['agent']];
  static usage = Command.Usage({
    description: 'Start an interactive Aura agent session',
    details: `
      Launches an interactive shell with the AI agent for the current workspace.
      Supports multi-line input, slash commands (/model, /session, /undo, /help), and tool use.
    `,
    examples: [
      ['Start interactive agent session', 'aura agent'],
      [
        'Run autonomously with a goal (classic mode)',
        'aura agent -g "Fix all failing tests"',
      ],
      [
        'Run with Ralph autonomous loop',
        'aura agent --mode ralph -g "Implement feature X"',
      ],
    ],
  });
  projectPath = Option.String({ required: false });

  verbose = Option.Boolean('-v,--verbose', false);
  goal = Option.String('-g,--goal');
  nonInteractive = Option.Boolean('--ni,--non-interactive', false);
  mode = Option.String('--mode', 'classic');
  verify = Option.String('--verify');
  critic = Option.Boolean('--critic', false);
  criticMode = Option.String('--critic_mode', 'light');
  maxSteps = Option.String('--max_steps');
  noDaemon = Option.Boolean('--no-daemon', false);

  async run() {
    const root = this.projectPath
      ? path.resolve(this.projectPath)
      : process.cwd();
    let steps: number | undefined;
    if (this.maxSteps !== undefined) {
      try {
        steps = PathResolver.validateMaxSteps(parseInt(this.maxSteps, 10));
      } catch (e: unknown) {
        throw new UI.CliError((e as Error).message);
      }
    }
    const options = {
      verbose: this.verbose,
      goal: this.goal,
      'non-interactive': this.nonInteractive,
      mode: this.mode,
      verify: this.verify,
      critic: this.critic,
      critic_mode: this.criticMode,
      max_steps: steps,
      'no-daemon': this.noDaemon,
    };
    const session = new Session(root, options);
    await session.start();
  }
}

class DaemonCommand extends BaseCommand {
  static paths = [['daemon']];
  static usage = Command.Usage({
    description: 'Start Aura daemon background server',
  });
  projectPath = Option.String({ required: false });

  async run() {
    const root = this.projectPath
      ? path.resolve(this.projectPath)
      : process.cwd();
    const { DaemonServer } = await import('../daemon/server.js');
    const server = new DaemonServer(root);

    const cleanup = () => {
      server.stop();
      process.exit(0);
    };

    process.once('exit', () => {
      server.stop();
    });
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);

    await server.start();
    // Keep event loop active
    await new Promise<void>(() => {});
  }
}

class WebCommand extends BaseCommand {
  static paths = [['web']];
  static usage = Command.Usage({
    description: 'Start the Aura web interface server',
    examples: [
      ['Start on default port 9299', 'aura web'],
      ['Start on custom port', 'aura web -p 8080'],
      ['Bind to all interfaces', 'aura web --host 0.0.0.0'],
    ],
  });
  projectPath = Option.String({ required: false });

  port = Option.String('-p,--port', '9299');
  host = Option.String('--host', '127.0.0.1');

  async run() {
    const root = this.projectPath
      ? path.resolve(this.projectPath)
      : process.cwd();
    let portNum = parseInt(this.port, 10);
    try {
      portNum = PathResolver.validatePort(portNum);
    } catch (e: unknown) {
      throw new UI.CliError((e as Error).message);
    }

    const server = new WebServer(root, portNum, this.host);
    await server.start();
  }
}

class AddCommand extends BaseCommand {
  static paths = [['add']];
  static usage = Command.Usage({
    description: 'Stage files inside the local Aura environment',
  });
  files = Option.Rest({ required: 1 });

  async run() {
    await Git.add(this.files);
  }
}

class CommitCommand extends BaseCommand {
  static paths = [['commit']];
  static usage = Command.Usage({
    description: 'Commit staged changes inside the local Aura environment',
  });
  message = Option.String('-m,--message', { required: true });

  async run() {
    await Git.commit(this.message);
  }
}

class SyncCommand extends BaseCommand {
  static paths = [['sync']];
  static usage = Command.Usage({
    description:
      'Push local workspace changes back to the global template repository',
  });

  async run() {
    await Git.sync();
  }
}

class PullCommand extends BaseCommand {
  static paths = [['pull']];
  static usage = Command.Usage({
    description: 'Pull new templates or updates from the global repository',
  });

  async run() {
    await Git.pull();
  }
}

class StatusCommand extends BaseCommand {
  static paths = [['status']];
  static usage = Command.Usage({
    description: 'Show what files are modified or untracked inside .aura-workspace',
  });

  async run() {
    await Git.status();
  }
}

class ChatCommand extends BaseCommand {
  static paths = [['chat']];
  static usage = Command.Usage({
    description: 'Start an interactive chat session or ask a single question',
    details:
      'Starts an interactive conversation loop or handles a one-off query with the AI model.',
    examples: [
      ['Start interactive chat session', 'aura chat'],
      ['Ask a direct question', 'aura chat "How do I list git tags?"'],
      [
        'Ask with system prompt',
        'aura chat "Refactor this" --system "Be concise"',
      ],
    ],
  });
  question = Option.String({ required: false });

  model = Option.String('--model');
  provider = Option.String('--provider');
  system = Option.String('--system');
  session = Option.String('-s,--session', 'default');
  clear = Option.Boolean('-c,--clear', false);

  async run() {
    const options = {
      model: this.model,
      provider: this.provider,
      system: this.system,
      session: this.session,
      clear: this.clear,
    };
    await Chat.run(this.question, options);
  }
}

class ToolsListCommand extends BaseCommand {
  static paths = [['tools', 'list']];
  static usage = Command.Usage({
    description: 'List all tools',
  });
  projectPath = Option.String({ required: false });
  human = Option.Boolean('-H,--human', false);

  async run() {
    Tools.list(this.projectPath, { human: this.human });
  }
}

class ToolsInspectCommand extends BaseCommand {
  static paths = [['tools', 'inspect']];
  static usage = Command.Usage({
    description: 'Inspect a tool by name',
  });
  name = Option.String({ required: true });
  pretty = Option.Boolean('-p,--pretty', false);
  human = Option.Boolean('-H,--human', false);

  async run() {
    await Tools.inspect(this.name, { pretty: this.pretty, human: this.human });
  }
}

class ToolsGenerateGroupCommand extends BaseCommand {
  static paths = [['tools', 'generate_group']];
  static usage = Command.Usage({
    description: 'Generate a hierarchical tool group',
  });
  name = Option.String({ required: true });
  subtools = Option.Rest();

  async run() {
    Tools.generateGroup(this.name, this.subtools || []);
  }
}

class ToolsAddCommand extends BaseCommand {
  static paths = [['tools', 'add']];
  static usage = Command.Usage({
    description: 'Install a library tool by name or URL/path',
  });
  toolNameOrUrl = Option.String({ required: true });

  async run() {
    await Tools.add(this.toolNameOrUrl);
  }
}

class ToolsInstallCommand extends BaseCommand {
  static paths = [['tools', 'install']];
  static usage = Command.Usage({
    description: 'Install a tool from a Git URL or local directory',
  });
  urlOrPath = Option.String({ required: true });
  name = Option.String({ required: false });

  async run() {
    await Tools.install(this.urlOrPath, this.name);
  }
}

class KernelObserveCommand extends BaseCommand {
  static paths = [['kernel', 'observe']];
  static usage = Command.Usage({
    description: 'Observe current environment and assemble context',
  });
  projectPath = Option.String({ required: false });
  human = Option.Boolean('-H,--human', false);
  previewLines = Option.String('-n,--preview-lines', '5');

  async run() {
    await Kernel.observe(this.projectPath, {
      human: this.human,
      previewLines: parseInt(this.previewLines, 10),
    });
  }
}

class KernelRunCallCommand extends BaseCommand {
  static paths = [['kernel', 'run_call']];
  static usage = Command.Usage({
    description: 'Run a specific tool call',
  });
  tool = Option.String({ required: true });
  argsJson = Option.String({ required: true });
  projectPath = Option.String({ required: false });

  async run() {
    await Kernel.runCall(this.tool, this.argsJson, this.projectPath);
  }
}

class KernelOnceCommand extends BaseCommand {
  static paths = [['kernel', 'once']];
  static usage = Command.Usage({
    description: 'Run Kernel once with a provided call payload',
  });
  projectPath = Option.String({ required: false });

  call = Option.String('-c,--call');
  input = Option.String('-i,--input');
  ask = Option.Boolean('-a,--ask', false);
  human = Option.Boolean('-H,--human', false);
  verbose = Option.Boolean('-v,--verbose', false);
  previewLines = Option.String('-n,--preview-lines', '5');

  async run() {
    await Kernel.once(this.projectPath, {
      call: this.call,
      input: this.input,
      ask: this.ask,
      human: this.human,
      verbose: this.verbose,
      previewLines: parseInt(this.previewLines, 10),
    });
  }
}

class KernelPlanCommand extends BaseCommand {
  static paths = [['kernel', 'plan']];
  static usage = Command.Usage({
    description: 'Run planner to produce next step',
  });
  projectPath = Option.String({ required: false });

  goal = Option.String('-g,--goal');
  human = Option.Boolean('-H,--human', false);
  previewLines = Option.String('-n,--preview-lines', '5');

  async run() {
    await Kernel.plan(this.projectPath, {
      goal: this.goal,
      human: this.human,
      previewLines: parseInt(this.previewLines, 10),
    });
  }
}

class KernelLoopCommand extends BaseCommand {
  static paths = [['kernel', 'loop']];
  static usage = Command.Usage({
    description: 'Run the agent in an autonomous loop until task completion',
    details:
      'Runs the planner-executor loop, calling tools iteratively until a final_answer is reached or max-steps is exceeded.',
    examples: [
      ['Run with explicit goal', 'aura kernel loop -g "Fix all TODO comments"'],
      [
        'Limit to 10 steps',
        'aura kernel loop -g "Refactor auth module" --max-steps 10',
      ],
      ['Human-readable output', 'aura kernel loop -g "..." --human'],
    ],
  });
  projectPath = Option.String({ required: false });

  goal = Option.String('-g,--goal');
  human = Option.Boolean('-H,--human', false);
  verbose = Option.Boolean('-v,--verbose', false);
  maxSteps = Option.String('-m,--max-steps', '30');

  async run() {
    await Kernel.loop(this.projectPath, {
      goal: this.goal,
      human: this.human,
      verbose: this.verbose,
      maxSteps: parseInt(this.maxSteps, 10),
    });
  }
}

class SkillListCommand extends BaseCommand {
  static paths = [['skill', 'list']];
  static usage = Command.Usage({
    description: 'List all skills and their status',
  });
  projectPath = Option.String({ required: false });
  json = Option.Boolean('-j,--json', false);

  async run() {
    await Skills.list(this.projectPath, { json: this.json });
  }
}

class SkillInstallCommand extends BaseCommand {
  static paths = [['skill', 'install']];
  static usage = Command.Usage({
    description: 'Install a skill from a Git URL or local directory',
  });
  urlOrPath = Option.String({ required: true });
  name = Option.String({ required: false });

  async run() {
    await Skills.install(this.urlOrPath, this.name);
  }
}

class HintsListCommand extends BaseCommand {
  static paths = [['hints', 'list']];
  static usage = Command.Usage({
    description: 'List all files parsed for hint injection and their status',
  });
  projectPath = Option.String({ required: false });

  async run() {
    await Hints.list(this.projectPath);
  }
}

class HintsToggleCommand extends BaseCommand {
  static paths = [['hints', 'toggle']];
  static usage = Command.Usage({
    description: 'Toggle hint injection status for a file',
  });
  filePath = Option.String({ required: true });
  projectPath = Option.String({ required: false });

  async run() {
    Hints.toggle(this.filePath, this.projectPath);
  }
}

class HintsGlobalCommand extends BaseCommand {
  static paths = [['hints', 'global']];
  static usage = Command.Usage({
    description: 'Show global operational guidance file',
  });

  async run() {
    Hints.global();
  }
}

class SessionListCommand extends BaseCommand {
  static paths = [['session', 'list']];
  static usage = Command.Usage({
    description: 'List all sessions',
  });
  json = Option.Boolean('-j,--json', false);

  async run() {
    SessionCmd.list({ json: this.json });
  }
}

class SessionCreateCommand extends BaseCommand {
  static paths = [['session', 'create']];
  static usage = Command.Usage({
    description: 'Create a new session',
  });
  name = Option.String({ required: true });

  async run() {
    SessionCmd.create(this.name);
  }
}

class SessionSwitchCommand extends BaseCommand {
  static paths = [['session', 'switch']];
  static usage = Command.Usage({
    description: 'Switch to a session',
  });
  name = Option.String({ required: true });

  async run() {
    SessionCmd.switchSession(this.name);
  }
}

class SessionDeleteCommand extends BaseCommand {
  static paths = [['session', 'delete']];
  static usage = Command.Usage({
    description: 'Delete a session',
  });
  name = Option.String({ required: true });

  async run() {
    await SessionCmd.deleteSession(this.name);
  }
}

class SessionDuplicateCommand extends BaseCommand {
  static paths = [['session', 'duplicate']];
  static usage = Command.Usage({
    description: 'Duplicate a session',
  });
  source = Option.String({ required: true });
  name = Option.String({ required: true });

  async run() {
    SessionCmd.duplicate(this.source, this.name);
  }
}

class SessionExportCommand extends BaseCommand {
  static paths = [['session', 'export']];
  static usage = Command.Usage({
    description: 'Export a session',
  });
  name = Option.String({ required: true });
  destPath = Option.String({ required: true });

  async run() {
    SessionCmd.exportSession(this.name, this.destPath);
  }
}

class SessionImportCommand extends BaseCommand {
  static paths = [['session', 'import']];
  static usage = Command.Usage({
    description: 'Import a session',
  });
  sourcePath = Option.String({ required: true });
  name = Option.String({ required: true });

  async run() {
    SessionCmd.importSession(this.sourcePath, this.name);
  }
}

class SessionRenameCommand extends BaseCommand {
  static paths = [['session', 'rename']];
  static usage = Command.Usage({
    description: 'Rename a session',
  });
  oldName = Option.String({ required: true });
  newName = Option.String({ required: true });

  async run() {
    SessionCmd.rename(this.oldName, this.newName);
  }
}

class SessionCurrentCommand extends BaseCommand {
  static paths = [['session', 'current']];
  static usage = Command.Usage({
    description: 'Show the current active session',
  });

  async run() {
    SessionCmd.current();
  }
}

class UpdateFrameworkCommand extends BaseCommand {
  static paths = [['update', 'framework']];
  static usage = Command.Usage({
    description: 'Update Aura framework',
  });
  force = Option.Boolean('-f,--force', false);

  async run() {
    await Update.framework({ force: this.force });
  }
}

class UpdateStatusCommand extends BaseCommand {
  static paths = [['update', 'status']];
  static usage = Command.Usage({
    description: 'Check template update status',
  });

  async run() {
    await Update.status();
  }
}

class UpdateAllCommand extends BaseCommand {
  static paths = [['update', 'all']];
  static usage = Command.Usage({
    description: 'Update all sub-projects',
  });
  merge = Option.Boolean('-m,--merge', false);

  async run() {
    await Update.all({ merge: this.merge });
  }
}

class UpdateProjectCommand extends BaseCommand {
  static paths = [['update', 'project']];
  static usage = Command.Usage({
    description: 'Update a single project',
  });
  pathOrName = Option.String({ required: true });
  merge = Option.Boolean('-m,--merge', false);

  async run() {
    await Update.project(this.pathOrName, { merge: this.merge });
  }
}

class UpdateCurrentCommand extends BaseCommand {
  static paths = [['update', 'current']];
  static usage = Command.Usage({
    description: 'Update current workspace templates',
  });
  merge = Option.Boolean('-m,--merge', false);

  async run() {
    await Update.current({ merge: this.merge });
  }
}

class UpdateMergeCommand extends BaseCommand {
  static paths = [['update', 'merge']];
  static usage = Command.Usage({
    description: 'Merge template updates',
  });
  stash = Option.Boolean('-s,--stash', false);
  force = Option.Boolean('-f,--force', false);

  async run() {
    await Update.merge({ stash: this.stash, force: this.force });
  }
}

class TemplateSyncCommand extends BaseCommand {
  static paths = [['template', 'sync']];
  static usage = Command.Usage({
    description: 'Sync template updates from Aura framework to global repo',
  });

  async run() {
    await Template.sync();
  }
}

class TemplateStatusCommand extends BaseCommand {
  static paths = [['template', 'status']];
  static usage = Command.Usage({
    description: 'Check template version and sync status',
  });

  async run() {
    await Template.status();
  }
}

class TemplateDiffCommand extends BaseCommand {
  static paths = [['template', 'diff']];
  static usage = Command.Usage({
    description: 'Show differences between framework templates and global repo',
  });

  async run() {
    await Template.diff();
  }
}

class GardenListCommand extends BaseCommand {
  static paths = [['garden', 'list']];
  static usage = Command.Usage({
    description: 'List all available Garden Playbooks',
  });
  projectPath = Option.String({ required: false });

  async run() {
    Garden.list(this.projectPath);
  }
}

class GardenStatusCommand extends BaseCommand {
  static paths = [['garden', 'status']];
  static usage = Command.Usage({
    description: 'Show workspace health and metrics',
  });
  projectPath = Option.String({ required: false });

  async run() {
    Garden.status(this.projectPath);
  }
}

class GardenInitCommand extends BaseCommand {
  static paths = [['garden', 'init']];
  static usage = Command.Usage({
    description: 'Initialize a Garden Playbook template',
  });
  playbookName = Option.String({ required: true });
  projectPath = Option.String({ required: false });

  async run() {
    Garden.init(this.playbookName, this.projectPath);
  }
}

// Global alias maps matching Thor maps
const aliasMap: Record<string, string[]> = {
  h: ['hints', 'list'],
  t: ['tools', 'list'],
  s: ['skill', 'list'],
  k: ['kernel', 'observe'],
  c: ['agent'],
  v: ['version'],
};

export function createCli(): Cli {
  const cli = new Cli({
    binaryName: 'aura',
    binaryLabel: 'AI-native operating system for folder-as-workspace agents',
    binaryVersion: VERSION,
  });

  // Register commands
  cli.register(CustomVersionCommand);
  cli.register(CustomHelpCommand);
  cli.register(CompletionCommand);
  cli.register(NewCommand);
  cli.register(DoctorCommand);
  cli.register(InfoCommand);
  cli.register(ConfigCommand);
  cli.register(BranchCommand);
  cli.register(ListCommand);
  cli.register(DeleteCommand);
  cli.register(RegisterCommand);
  cli.register(PruneCommand);
  cli.register(ContextCommand);
  cli.register(AgentCommand);
  cli.register(DaemonCommand);
  cli.register(WebCommand);
  cli.register(AddCommand);
  cli.register(CommitCommand);
  cli.register(SyncCommand);
  cli.register(PullCommand);
  cli.register(StatusCommand);
  cli.register(ChatCommand);
  cli.register(ToolsListCommand);
  cli.register(ToolsInspectCommand);
  cli.register(ToolsGenerateGroupCommand);
  cli.register(ToolsAddCommand);
  cli.register(ToolsInstallCommand);
  cli.register(KernelObserveCommand);
  cli.register(KernelRunCallCommand);
  cli.register(KernelOnceCommand);
  cli.register(KernelPlanCommand);
  cli.register(KernelLoopCommand);
  cli.register(SkillListCommand);
  cli.register(SkillInstallCommand);
  cli.register(HintsListCommand);
  cli.register(HintsToggleCommand);
  cli.register(HintsGlobalCommand);
  cli.register(SessionListCommand);
  cli.register(SessionCreateCommand);
  cli.register(SessionSwitchCommand);
  cli.register(SessionDeleteCommand);
  cli.register(SessionDuplicateCommand);
  cli.register(SessionExportCommand);
  cli.register(SessionImportCommand);
  cli.register(SessionRenameCommand);
  cli.register(SessionCurrentCommand);
  cli.register(UpdateFrameworkCommand);
  cli.register(UpdateStatusCommand);
  cli.register(UpdateAllCommand);
  cli.register(UpdateProjectCommand);
  cli.register(UpdateCurrentCommand);
  cli.register(UpdateMergeCommand);
  cli.register(TemplateSyncCommand);
  cli.register(TemplateStatusCommand);
  cli.register(TemplateDiffCommand);
  cli.register(GardenListCommand);
  cli.register(GardenStatusCommand);
  cli.register(GardenInitCommand);

  return cli;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const args = [...argv];
  const firstArg = args[2];

  if (firstArg && aliasMap[firstArg]) {
    args.splice(2, 1, ...aliasMap[firstArg]);
  }

  const cli = createCli();

  const cleanup = () => {
    console.log(
      picocolors.yellow(
        '\n\n⚠️ Aura: Interrupted by user. Cleaning up resources and shutting down...',
      ),
    );
    process.exit(130);
  };

  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);

  process.on('unhandledRejection', (reason) => {
    console.error(picocolors.red(`⛔️ Unhandled promise rejection: ${reason}`));
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    console.error(picocolors.red(`⛔️ Uncaught exception: ${error.message}`));
    if (error.stack && process.env.DEBUG) {
      console.error(picocolors.gray(error.stack));
    }
    process.exit(1);
  });

  try {
    await cli.run(args.slice(2));
    process.exit(0);
  } catch (e: unknown) {
    if (e instanceof UI.CliError) {
      UI.printError(e.message);
      if (e.tip) {
        console.log(picocolors.dim(`  Tip: ${e.tip}`));
      }
      process.exit(e.exitCode || 1);
    } else {
      console.error(
        picocolors.red(
          `⛔️ An unexpected error occurred: ${(e as Error).message}`,
        ),
      );
      if ((e as Error).stack) {
        console.error(picocolors.gray((e as Error).stack));
      }
      process.exit(1);
    }
  }
}

const isMain = () => {
  try {
    return (
      process.argv[1] &&
      fs.realpathSync(process.argv[1]) ===
        fs.realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
};

if (isMain()) {
  main();
}

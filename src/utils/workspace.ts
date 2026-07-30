import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import * as UI from '../cli/ui.js';
import * as ConfigManager from './configManager.js';
import * as GlobalConfig from './globalConfig.js';
import * as PathResolver from './pathResolver.js';
import * as ProjectRegistry from './projectRegistry.js';

/**
 * An Aura workspace: a project directory paired with its hidden environment
 * directory (`.aura-workspace`, or a legacy `.aura`, or the project root
 * itself if neither exists yet — see PathResolver.environmentPath(), the
 * single resolution rule all three factories below share). Always go
 * through one of the static factories rather than tracking projectPath/
 * envPath separately by hand.
 */
export class Workspace {
  public readonly projectPath: string;
  public readonly envPath: string;

  private constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.envPath = PathResolver.environmentPath(projectPath) || projectPath;
  }

  /**
   * References an already-bootstrapped workspace at `targetDir` — no git
   * clone, no registry write, just identity resolution (realpath'd project
   * root + its env directory). Use this anywhere a workspace is assumed to
   * already exist (e.g. Runner opening one), as opposed to atDirectory()/
   * sandbox() which create one.
   */
  static at(targetDir: string): Workspace {
    const projectPath = fs.existsSync(targetDir)
      ? fs.realpathSync(targetDir)
      : path.resolve(targetDir);
    return new Workspace(projectPath);
  }

  /**
   * Bootstraps a workspace at `targetDir` itself: clones the global template,
   * registers the project, and sets up `.gitignore` hygiene around the
   * hidden environment. Use this when the user is initializing their own
   * project directory (`aura new`).
   */
  static async atDirectory(targetDir: string): Promise<Workspace> {
    const projectPath = path.resolve(targetDir);
    let projectName = path.basename(projectPath).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!projectName) {
      projectName = 'aura_workspace';
    }
    const hidden = path.join(projectPath, '.aura-workspace');

    await GlobalConfig.ensureRepo();

    console.log(`Initializing Aura workspace in-place at: ${projectPath}...`);
    try {
      await execa('git', ['clone', GlobalConfig.repoPath(), hidden]);
      await GlobalConfig.gitRun(hidden, 'config', 'user.name', 'Aura Workspace');
      await GlobalConfig.gitRun(
        hidden,
        'config',
        'user.email',
        'workspace@aura-os.ai',
      );

      // Copy configuration file from global repo template
      const srcCfg = PathResolver.resolveConfigPath(GlobalConfig.repoPath());
      if (srcCfg && fs.existsSync(srcCfg)) {
        const destCfg = path.join(hidden, 'config', 'config.yml');
        fs.mkdirSync(path.dirname(destCfg), { recursive: true });
        fs.copyFileSync(srcCfg, destCfg);
      }

      // Inject .gitignore rule in parent directory
      const gitIgnorePath = path.join(projectPath, '.gitignore');
      const existingRules = fs.existsSync(gitIgnorePath)
        ? fs.readFileSync(gitIgnorePath, 'utf-8')
        : '';
      if (!existingRules.includes('.aura-workspace/')) {
        fs.writeFileSync(
          gitIgnorePath,
          `${existingRules}\n.aura-workspace/\n`,
          'utf-8',
        );
        console.log(
          '\x1b[32mInjected .gitignore rule for hidden .aura-workspace environment.\x1b[0m',
        );
      }

      // Inject .gitignore rule inside .aura folder to ignore runtime databases
      const innerIgnorePath = path.join(hidden, '.gitignore');
      const innerRules = fs.existsSync(innerIgnorePath)
        ? fs.readFileSync(innerIgnorePath, 'utf-8')
        : '';
      const newRules = [
        'state/aura.db*',
        'state/**/*.db*',
        'state/sessions/',
        'state/chat_sessions/',
      ];
      let updatedRules = innerRules;
      let changed = false;
      for (const rule of newRules) {
        if (!updatedRules.includes(rule)) {
          updatedRules = `${updatedRules.trim()}\n${rule}\n`;
          changed = true;
        }
      }
      if (changed) {
        fs.writeFileSync(innerIgnorePath, updatedRules, 'utf-8');
      }

      const registeredName = ProjectRegistry.register(projectName, projectPath);

      const cfgPath = path.join(hidden, 'config', 'config.yml');
      if (fs.existsSync(cfgPath)) {
        try {
          const cfg = ConfigManager.load(projectPath) || {};
          cfg.project_name = registeredName;
          ConfigManager.write(cfgPath, cfg);
        } catch (e: unknown) {
          console.warn(
            `\x1b[33m⚠️ Warning: Failed to write workspace config: ${(e as Error).message}\x1b[0m`,
          );
        }
      }

      console.log('\x1b[32mWorkspace initialized successfully!\x1b[0m');
      return new Workspace(projectPath);
    } catch (err: unknown) {
      throw new UI.CliError(
        `Failed to initialize workspace:\n${(err as Error).message}`,
      );
    }
  }

  /**
   * Bootstraps (or reuses) the single global sandbox workspace shared by
   * every directory that isn't its own Aura project — the fallback when the
   * user declines to initialize the current directory.
   */
  static async sandbox(): Promise<Workspace> {
    const sandboxPath = path.join(GlobalConfig.auraHome(), 'sandbox');
    const sandboxAura = path.join(sandboxPath, '.aura-workspace');

    console.log(
      `\x1b[34mℹ️ Routing to global sandbox workspace: ${sandboxPath}\x1b[0m`,
    );

    if (!fs.existsSync(sandboxAura)) {
      fs.mkdirSync(sandboxPath, { recursive: true });
      await GlobalConfig.ensureRepo();

      console.log('Initializing global sandbox workspace...');
      try {
        await execa('git', ['clone', GlobalConfig.repoPath(), sandboxAura]);
        await GlobalConfig.gitRun(
          sandboxAura,
          'config',
          'user.name',
          'Aura Sandbox',
        );
        await GlobalConfig.gitRun(
          sandboxAura,
          'config',
          'user.email',
          'sandbox@aura-os.ai',
        );

        // Copy configuration file from global repo template
        const srcCfg = PathResolver.resolveConfigPath(GlobalConfig.repoPath());
        if (srcCfg && fs.existsSync(srcCfg)) {
          const destCfg = path.join(sandboxAura, 'config', 'config.yml');
          fs.mkdirSync(path.dirname(destCfg), { recursive: true });
          fs.copyFileSync(srcCfg, destCfg);
        }

        // Inject .gitignore rule inside .aura folder to ignore runtime databases
        const innerIgnorePath = path.join(sandboxAura, '.gitignore');
        const innerRules = fs.existsSync(innerIgnorePath)
          ? fs.readFileSync(innerIgnorePath, 'utf-8')
          : '';
        const newRules = [
          'state/aura.db*',
          'state/**/*.db*',
          'state/sessions/',
          'state/chat_sessions/',
        ];
        let updatedRules = innerRules;
        let changed = false;
        for (const rule of newRules) {
          if (!updatedRules.includes(rule)) {
            updatedRules = `${updatedRules.trim()}\n${rule}\n`;
            changed = true;
          }
        }
        if (changed) {
          fs.writeFileSync(innerIgnorePath, updatedRules, 'utf-8');
        }

        // Record sandbox project
        ProjectRegistry.register('sandbox', sandboxPath);

        // Record sandbox project name in config
        const cfgPath = path.join(sandboxAura, 'config', 'config.yml');
        if (fs.existsSync(cfgPath)) {
          try {
            const cfg = ConfigManager.load(sandboxAura) || {};
            cfg.project_name = 'sandbox';
            ConfigManager.write(cfgPath, cfg);
          } catch (e: unknown) {
            console.warn(
              `\x1b[33m⚠️ Warning: Failed to write sandbox config: ${(e as Error).message}\x1b[0m`,
            );
          }
        }
        console.log(
          '\x1b[32mGlobal sandbox workspace initialized successfully!\x1b[0m',
        );
      } catch (err: unknown) {
        throw new UI.CliError(
          `Failed to clone global templates into sandbox workspace:\n${(err as Error).message}`,
        );
      }
    }

    return new Workspace(sandboxPath);
  }
}

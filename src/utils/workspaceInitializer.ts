import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import yaml from 'yaml';
import * as UI from '../cli/ui.js';
import * as ConfigManager from './configManager.js';
import * as GlobalConfig from './globalConfig.js';
import * as PathResolver from './pathResolver.js';
import * as ProjectRegistry from './projectRegistry.js';

/**
 * Resolve project workspace path by climbing parent directories.
 * If not in a workspace, guides the user to initialize a new workspace or falls back to a global sandbox.
 */
export async function resolveProjectPath(
  projectPath: string | null,
): Promise<string> {
  const resolved = PathResolver.resolveProjectPath(projectPath || undefined);
  if (resolved) {
    return resolved;
  }
  return await handleNoWorkspace(projectPath || process.cwd());
}

/**
 * Safe YAML file loader
 */
export function safeLoadYaml(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return (yaml.parse(raw) || {}) as Record<string, unknown>;
  } catch (_e) {
    return {};
  }
}

export async function handleNoWorkspace(startDir: string): Promise<string> {
  console.warn(
    '\x1b[33m⚠️ Warning: Not in an Aura workspace (no .aura folder found in parent directories).\x1b[0m',
  );

  const isTest = process.env.NODE_ENV === 'test' || process.env.CI === 'true';
  let useSandbox = true;

  if (!isTest) {
    const answer = await UI.confirm(
      '❓ Would you like to initialize a new Aura workspace in the current directory?',
    );
    useSandbox = !answer;
  }

  if (useSandbox) {
    return await initializeSandbox();
  } else {
    return await initializeWorkspaceInPlace(startDir);
  }
}

export async function initializeSandbox(): Promise<string> {
  const sandboxPath = path.join(os.homedir(), '.aura', 'sandbox');
  const sandboxAura = path.join(sandboxPath, '.aura');

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
      if (!innerRules.includes('state/aura.db*')) {
        fs.writeFileSync(
          innerIgnorePath,
          `${innerRules}\nstate/aura.db*\n`,
          'utf-8',
        );
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

  return sandboxPath;
}

export async function initializeWorkspaceInPlace(
  targetDir: string,
): Promise<string> {
  const projectPath = path.resolve(targetDir);
  let projectName = path.basename(projectPath).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!projectName) {
    projectName = 'aura_workspace';
  }
  const hidden = path.join(projectPath, '.aura');

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
    if (!existingRules.includes('.aura/')) {
      fs.writeFileSync(gitIgnorePath, `${existingRules}\n.aura/\n`, 'utf-8');
      console.log(
        '\x1b[32mInjected .gitignore rule for hidden .aura environment.\x1b[0m',
      );
    }

    // Inject .gitignore rule inside .aura folder to ignore runtime databases
    const innerIgnorePath = path.join(hidden, '.gitignore');
    const innerRules = fs.existsSync(innerIgnorePath)
      ? fs.readFileSync(innerIgnorePath, 'utf-8')
      : '';
    if (!innerRules.includes('state/aura.db*')) {
      fs.writeFileSync(
        innerIgnorePath,
        `${innerRules}\nstate/aura.db*\n`,
        'utf-8',
      );
    }

    ProjectRegistry.register(projectName, projectPath);

    const cfgPath = path.join(hidden, 'config', 'config.yml');
    if (fs.existsSync(cfgPath)) {
      try {
        const cfg = ConfigManager.load(projectPath) || {};
        cfg.project_name = projectName;
        ConfigManager.write(cfgPath, cfg);
      } catch (e: unknown) {
        console.warn(
          `\x1b[33m⚠️ Warning: Failed to write workspace config: ${(e as Error).message}\x1b[0m`,
        );
      }
    }

    console.log('\x1b[32mWorkspace initialized successfully!\x1b[0m');
    return projectPath;
  } catch (err: unknown) {
    throw new UI.CliError(
      `Failed to initialize workspace:\n${(err as Error).message}`,
    );
  }
}

export async function initializeGlobalEnv(): Promise<string> {
  const globalEnv = path.resolve(os.homedir(), '.aura', 'global');

  if (!fs.existsSync(globalEnv)) {
    fs.mkdirSync(path.dirname(globalEnv), { recursive: true });
    await GlobalConfig.ensureRepo();

    console.log(`Initializing global environment at ${globalEnv}...`);
    try {
      await execa('git', ['clone', GlobalConfig.repoPath(), globalEnv]);
      await GlobalConfig.gitRun(
        globalEnv,
        'config',
        'user.name',
        'Aura Global',
      );
      await GlobalConfig.gitRun(
        globalEnv,
        'config',
        'user.email',
        'global@aura-os.ai',
      );

      // Copy configuration file from global repo template
      const srcCfg = PathResolver.resolveConfigPath(GlobalConfig.repoPath());
      if (srcCfg && fs.existsSync(srcCfg)) {
        const destCfg = path.join(globalEnv, 'config', 'config.yml');
        fs.mkdirSync(path.dirname(destCfg), { recursive: true });
        fs.copyFileSync(srcCfg, destCfg);
      }

      // Inject .gitignore rule inside .aura folder to ignore runtime databases
      const innerIgnorePath = path.join(globalEnv, '.gitignore');
      const innerRules = fs.existsSync(innerIgnorePath)
        ? fs.readFileSync(innerIgnorePath, 'utf-8')
        : '';
      if (!innerRules.includes('state/aura.db*')) {
        fs.writeFileSync(
          innerIgnorePath,
          `${innerRules}\nstate/aura.db*\n`,
          'utf-8',
        );
      }

      // Record global project name in config
      const cfgPath = path.join(globalEnv, 'config', 'config.yml');
      if (fs.existsSync(cfgPath)) {
        try {
          const cfg = ConfigManager.load(globalEnv) || {};
          cfg.project_name = 'global';
          ConfigManager.write(cfgPath, cfg);
        } catch (e: unknown) {
          console.warn(
            `\x1b[33m⚠️ Warning: Failed to write global config: ${(e as Error).message}\x1b[0m`,
          );
        }
      }
      console.log(
        '\x1b[32mGlobal environment initialized successfully!\x1b[0m',
      );
    } catch (err: unknown) {
      throw new UI.CliError(
        `Failed to initialize global environment:\n${(err as Error).message}`,
      );
    }
  }

  return globalEnv;
}

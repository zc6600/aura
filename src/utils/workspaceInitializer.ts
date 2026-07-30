import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import yaml from 'yaml';
import * as UI from '../cli/ui.js';
import * as ConfigManager from './configManager.js';
import * as GlobalConfig from './globalConfig.js';
import * as PathResolver from './pathResolver.js';
import { Workspace } from './workspace.js';

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
    '\x1b[33m⚠️ Warning: Not in an Aura workspace (no .aura-workspace folder found in parent directories).\x1b[0m',
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

/**
 * @deprecated Thin wrapper kept for existing callers; prefer `Workspace.sandbox()`
 * directly, which returns the assembled Workspace instead of just its path.
 */
export async function initializeSandbox(): Promise<string> {
  const ws = await Workspace.sandbox();
  return ws.projectPath;
}

/**
 * @deprecated Thin wrapper kept for existing callers; prefer `Workspace.atDirectory()`
 * directly, which returns the assembled Workspace instead of just its path.
 */
export async function initializeWorkspaceInPlace(
  targetDir: string,
): Promise<string> {
  const ws = await Workspace.atDirectory(targetDir);
  return ws.projectPath;
}

export async function initializeGlobalEnv(): Promise<string> {
  const globalEnv = path.resolve(GlobalConfig.auraHome(), 'global');

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

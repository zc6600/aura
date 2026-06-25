import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import picocolors from 'picocolors';
import yaml from 'yaml';
import { deepMerge } from './fsUtils.js';
import { errorMessage, errorOutput } from './typing.js';

// Helper to get directory name safely in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function gitRun(
  dir: string,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; success: boolean }> {
  try {
    const { stdout, stderr } = await execa('git', ['-C', dir, ...args]);
    return {
      stdout: stdout.toString().trim(),
      stderr: stderr.toString().trim(),
      success: true,
    };
  } catch (e: unknown) {
    const { stdout, stderr } = errorOutput(e);
    return {
      stdout: stdout?.toString().trim() || '',
      stderr: stderr?.toString().trim() || errorMessage(e),
      success: false,
    };
  }
}

export function repoPath(): string {
  return process.env.AURA_GLOBAL_REPO_PATH || path.join(auraHome(), 'repo');
}

export function auraHome(): string {
  return process.env.AURA_HOME || path.join(os.homedir(), '.aura-framework');
}

export function configPath(): string {
  return path.join(auraHome(), 'config.yml');
}

export async function ensureRepo(): Promise<void> {
  const repo = repoPath();
  const repoConfigDir = path.join(repo, 'config');
  const repoConfigFile = path.join(repo, 'config.yml');

  // Handle migration of config.yml to config/config.yml if it exists
  if (fs.existsSync(repoConfigFile)) {
    fs.mkdirSync(repoConfigDir, { recursive: true });
    const targetConfigFile = path.join(repoConfigDir, 'config.yml');

    if (fs.existsSync(targetConfigFile)) {
      try {
        const existingRaw = fs.readFileSync(targetConfigFile, 'utf-8');
        const templateRaw = fs.readFileSync(repoConfigFile, 'utf-8');

        const existingCfg = yaml.parse(existingRaw) || {};
        const templateCfg = yaml.parse(templateRaw) || {};

        // Deep merge user overrides on top of templates
        const mergedCfg = deepMerge(templateCfg, existingCfg);

        fs.writeFileSync(targetConfigFile, yaml.stringify(mergedCfg), 'utf-8');
        fs.unlinkSync(repoConfigFile);
      } catch (_err) {
        fs.renameSync(repoConfigFile, targetConfigFile);
      }
    } else {
      fs.renameSync(repoConfigFile, targetConfigFile);
    }

    if (fs.existsSync(path.join(repo, '.git'))) {
      await gitRun(repo, 'add', '.');
      await gitRun(
        repo,
        'commit',
        '-m',
        'Migrate config.yml to config/config.yml',
      );
    }
  }

  // If already initialized as a Git repository, we can return
  if (fs.existsSync(path.join(repo, '.git'))) {
    return;
  }

  fs.mkdirSync(repo, { recursive: true });

  // Copy default templates from generators directory
  let gemTemplates = path.resolve(
    __dirname,
    '..',
    'generators',
    'aura',
    'app',
    'templates',
  );
  if (!fs.existsSync(gemTemplates)) {
    gemTemplates = path.resolve(
      __dirname,
      '../..',
      'src',
      'generators',
      'aura',
      'app',
      'templates',
    );
  }

  if (fs.existsSync(gemTemplates) && fs.statSync(gemTemplates).isDirectory()) {
    copyFolderSync(gemTemplates, repo);
  }

  // Initialize global repo as a Git repository
  await gitRun(repo, 'init');
  await gitRun(repo, 'config', 'user.name', 'Aura CLI');
  await gitRun(repo, 'config', 'user.email', 'support@aura-os.ai');
  await gitRun(repo, 'config', 'receive.denyCurrentBranch', 'updateInstead');

  await gitRun(repo, 'add', '.');
  await gitRun(repo, 'commit', '-m', 'Initial template commit');
  await gitRun(repo, 'branch', '-M', 'main');
}

function copyFolderSync(from: string, to: string) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach((element) => {
    const fromPath = path.join(from, element);
    const toPath = path.join(to, element);
    if (fs.lstatSync(fromPath).isDirectory()) {
      copyFolderSync(fromPath, toPath);
    } else {
      if (!fs.existsSync(toPath)) {
        fs.copyFileSync(fromPath, toPath);
      }
    }
  });
}

/**
 * Restores the backed up user/global config, recursively deep merges it with the new configuration,
 * and writes the result back to configPath.
 */
export function restoreAndMergeConfig(
  configBackup: string,
  configPath: string,
  options: { label?: string; templateConfigPath?: string } = {},
): void {
  if (!fs.existsSync(configBackup)) return;

  const label = options.label || 'user';
  const newConfigSrc = options.templateConfigPath || configPath;

  try {
    const backupCfg = yaml.parse(fs.readFileSync(configBackup, 'utf-8')) || {};
    const newCfg = fs.existsSync(newConfigSrc)
      ? yaml.parse(fs.readFileSync(newConfigSrc, 'utf-8')) || {}
      : {};

    const merged = deepMerge(newCfg, backupCfg);

    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(configPath, yaml.stringify(merged), 'utf-8');
    console.log(
      `  ${picocolors.green(`✓ Restored and merged ${label} config.yml`)}`,
    );

    // Clean up template config if it was copied to root and is different from configPath
    if (
      options.templateConfigPath &&
      fs.existsSync(options.templateConfigPath) &&
      options.templateConfigPath !== configPath
    ) {
      try {
        fs.unlinkSync(options.templateConfigPath);
      } catch {}
    }
  } catch (e: unknown) {
    try {
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.copyFileSync(configBackup, configPath);
      console.log(
        `  ${picocolors.yellow(
          `⚠️  Merge failed: ${errorMessage(e)}. Restored ${label} config.yml from backup.`,
        )}`,
      );
    } catch (err: unknown) {
      console.error(
        `  🔴 Critical: Failed to restore config.yml backup: ${errorMessage(err)}`,
      );
    }
  } finally {
    try {
      fs.unlinkSync(configBackup);
    } catch {}
  }
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import yaml from 'yaml';

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
  } catch (e: any) {
    return {
      stdout: e.stdout?.toString().trim() || '',
      stderr: e.stderr?.toString().trim() || e.message || '',
      success: false,
    };
  }
}

export function repoPath(): string {
  return (
    process.env.AURA_GLOBAL_REPO_PATH ||
    path.join(os.homedir(), '.aura', 'repo')
  );
}

export function configPath(): string {
  return path.join(os.homedir(), '.aura', 'config.yml');
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
        const mergedCfg = { ...templateCfg, ...existingCfg };
        if (templateCfg.llm && existingCfg.llm) {
          mergedCfg.llm = { ...templateCfg.llm, ...existingCfg.llm };
        }
        if (templateCfg.state_management && existingCfg.state_management) {
          mergedCfg.state_management = {
            ...templateCfg.state_management,
            ...existingCfg.state_management,
          };
        }
        if (templateCfg.ralph && existingCfg.ralph) {
          mergedCfg.ralph = { ...templateCfg.ralph, ...existingCfg.ralph };
        }

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
      '..',
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
      fs.copyFileSync(fromPath, toPath);
    }
  });
}

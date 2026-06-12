import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import picocolors from 'picocolors';
import yaml from 'yaml';
import { VERSION } from '../../index.js';
import * as GlobalConfig from '../../utils/globalConfig.js';
import * as UI from '../ui.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findPackageRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

export class Template {
  public static async sync(): Promise<void> {
    console.log(
      '📦 Syncing templates from framework to global repo (~/.aura-framework/repo)...',
    );
    console.log('='.repeat(60));

    const packageRoot = findPackageRoot(__dirname);
    let gemTemplates = path.join(
      packageRoot,
      'dist',
      'generators',
      'aura',
      'app',
      'templates',
    );
    if (!fs.existsSync(gemTemplates)) {
      gemTemplates = path.join(
        packageRoot,
        'src',
        'generators',
        'aura',
        'app',
        'templates',
      );
    }

    const globalRepo = GlobalConfig.repoPath();

    if (!fs.existsSync(gemTemplates)) {
      throw new UI.CliError(`Template source not found at: ${gemTemplates}`);
    }

    // Backup user modifications
    console.log('\n📋 Detecting user modifications...');
    if (fs.existsSync(path.join(globalRepo, '.git'))) {
      const statusOut = await GlobalConfig.gitRun(
        globalRepo,
        'status',
        '--porcelain',
      );
      if (statusOut.stdout.trim().length > 0) {
        console.log('  Found uncommitted changes, creating backup commit...');
        await GlobalConfig.gitRun(globalRepo, 'add', '.');
        await GlobalConfig.gitRun(
          globalRepo,
          'commit',
          '-m',
          'Before template sync: user changes backup',
        );
        console.log(`  ${picocolors.green('✓ Backup created')}`);
      }
    }

    // Sync templates (overwrite)
    console.log('\n🔄 Syncing templates...');
    console.log(`  Source: ${gemTemplates}`);
    console.log(`  Target: ${globalRepo}`);

    const configPath = path.join(globalRepo, 'config', 'config.yml');
    let configBackup: string | null = null;
    let tmpDir: string | null = null;

    if (fs.existsSync(configPath)) {
      try {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-temp-sync-'));
        configBackup = path.join(tmpDir, 'config.yml');
        fs.copyFileSync(configPath, configBackup);
        console.log(`  ${picocolors.yellow('⚠️  Backed up global config.yml')}`);
      } catch (err: any) {
        console.warn(`  ⚠️ Failed to back up global config: ${err.message}`);
      }
    }

    if (fs.existsSync(globalRepo)) {
      const files = fs.readdirSync(globalRepo);
      for (const file of files) {
        if (file === '.git') continue;
        fs.rmSync(path.join(globalRepo, file), {
          recursive: true,
          force: true,
        });
      }
      console.log(
        `  ${picocolors.yellow('✓ Cleaned old templates (kept .git history)')}`,
      );
    } else {
      fs.mkdirSync(globalRepo, { recursive: true });
    }

    // Copy new templates
    Template.copyFolderSync(gemTemplates, globalRepo);
    console.log(`  ${picocolors.green('✓ Copied new templates')}`);

    // Restore and merge config if backed up, or migrate config.yml if not
    const templateRootConfig = path.join(globalRepo, 'config.yml');
    if (configBackup && fs.existsSync(configBackup)) {
      GlobalConfig.restoreAndMergeConfig(configBackup, configPath, {
        label: 'global',
        templateConfigPath: templateRootConfig,
      });
    } else if (fs.existsSync(templateRootConfig)) {
      try {
        const dir = path.dirname(configPath);
        fs.mkdirSync(dir, { recursive: true });
        fs.renameSync(templateRootConfig, configPath);
      } catch {}
    }

    // Reinitialize Git
    console.log('\n🔧 Reinitializing git repository...');
    await GlobalConfig.gitRun(globalRepo, 'init');
    await GlobalConfig.gitRun(globalRepo, 'config', 'user.name', 'Aura CLI');
    await GlobalConfig.gitRun(
      globalRepo,
      'config',
      'user.email',
      'support@aura-os.ai',
    );
    await GlobalConfig.gitRun(
      globalRepo,
      'config',
      'receive.denyCurrentBranch',
      'updateInstead',
    );
    const checkBranch = await GlobalConfig.gitRun(
      globalRepo,
      'rev-parse',
      '--verify',
      'main',
    );
    if (checkBranch.success) {
      await GlobalConfig.gitRun(globalRepo, 'checkout', 'main');
    } else {
      await GlobalConfig.gitRun(globalRepo, 'checkout', '-b', 'main');
    }
    await GlobalConfig.gitRun(globalRepo, 'add', '.');

    const hasHead = await GlobalConfig.gitRun(globalRepo, 'rev-parse', 'HEAD');
    if (hasHead.success) {
      const diffIndex = await GlobalConfig.gitRun(
        globalRepo,
        'diff-index',
        '--quiet',
        'HEAD',
      );
      if (!diffIndex.success) {
        await GlobalConfig.gitRun(
          globalRepo,
          'commit',
          '-m',
          `Template update from framework v${VERSION}`,
        );
      }
    } else {
      await GlobalConfig.gitRun(
        globalRepo,
        'commit',
        '-m',
        `Template update from framework v${VERSION}`,
      );
    }

    console.log(`\n${picocolors.green('✓ Templates synced to global repo!')}`);
    console.log('\n💡 Next steps:');
    console.log('  - Sub-projects can now pull updates via: aura pull');
    console.log('  - Or merge with conflict resolution: aura update merge');
    console.log('  - Update all projects: aura update all');
  }

  public static async status(): Promise<void> {
    const packageRoot = findPackageRoot(__dirname);
    let gemTemplates = path.join(
      packageRoot,
      'dist',
      'generators',
      'aura',
      'app',
      'templates',
    );
    if (!fs.existsSync(gemTemplates)) {
      gemTemplates = path.join(
        packageRoot,
        'src',
        'generators',
        'aura',
        'app',
        'templates',
      );
    }

    const globalRepo = GlobalConfig.repoPath();

    console.log('📊 Template Sync Status\n');
    console.log('='.repeat(60));

    console.log('Framework Templates:');
    console.log(`  Path: ${gemTemplates}`);
    if (fs.existsSync(gemTemplates)) {
      console.log(`  Status: ${picocolors.green('Exists')}`);

      const files = Template.globFiles(gemTemplates);
      console.log(`  Files: ${files.length}`);
    } else {
      console.log(`  Status: ${picocolors.red('Not found')}`);
    }

    console.log(`\nGlobal Repository (~/.aura-framework/repo):`);
    console.log(`  Path: ${globalRepo}`);
    if (fs.existsSync(globalRepo)) {
      console.log(`  Status: ${picocolors.green('Exists')}`);

      if (fs.existsSync(path.join(globalRepo, '.git'))) {
        console.log(`  Git: ${picocolors.green('Initialized')}`);
        const logOut = await GlobalConfig.gitRun(
          globalRepo,
          'log',
          '--oneline',
          '-1',
        );
        if (logOut.success) {
          console.log(`  Last Commit: ${logOut.stdout.trim()}`);
        }
        console.log(`\n  ⚠️  Note: To sync framework templates to global repo:`);
        console.log('     Run: aura template sync');
      } else {
        console.log(`  Git: ${picocolors.red('Not initialized')}`);
      }
    } else {
      console.log(
        `  Status: ${picocolors.yellow("Not found (will be created on first 'aura new')")}`,
      );
    }
  }

  public static async diff(): Promise<void> {
    const packageRoot = findPackageRoot(__dirname);
    let gemTemplates = path.join(
      packageRoot,
      'dist',
      'generators',
      'aura',
      'app',
      'templates',
    );
    if (!fs.existsSync(gemTemplates)) {
      gemTemplates = path.join(
        packageRoot,
        'src',
        'generators',
        'aura',
        'app',
        'templates',
      );
    }

    const globalRepo = GlobalConfig.repoPath();

    if (!fs.existsSync(gemTemplates)) {
      throw new UI.CliError('Framework templates not found!');
    }

    if (!fs.existsSync(globalRepo)) {
      throw new UI.CliError(`Global repo not found. Run 'aura new' first.`);
    }

    console.log('🔍 Comparing framework templates vs global repo...\n');
    console.log('='.repeat(60));

    try {
      // Use diff -rq command, excluding internal git files and OS metadata
      const { stdout } = await execa('diff', [
        '-rq',
        '-x',
        '.git',
        '-x',
        '.DS_Store',
        gemTemplates,
        globalRepo,
      ]);
      if (stdout.trim().length === 0) {
        console.log(
          picocolors.green(
            '✓ Framework templates and global repo are in sync!',
          ),
        );
      } else {
        console.log(`${picocolors.yellow('⚠️  Differences found:')}\n`);
        console.log(stdout);
        console.log('\nTo sync, run: aura template sync');
      }
    } catch (e: any) {
      if (e.stdout?.toString().trim()) {
        console.log(`${picocolors.yellow('⚠️  Differences found:')}\n`);
        console.log(e.stdout.toString());
        console.log('\nTo sync, run: aura template sync');
      } else {
        console.log(
          picocolors.green(
            '✓ Framework templates and global repo are in sync!',
          ),
        );
      }
    }
  }

  private static copyFolderSync(from: string, to: string) {
    fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from).forEach((element) => {
      const fromPath = path.join(from, element);
      const toPath = path.join(to, element);
      if (fs.lstatSync(fromPath).isDirectory()) {
        Template.copyFolderSync(fromPath, toPath);
      } else {
        fs.copyFileSync(fromPath, toPath);
      }
    });
  }

  private static globFiles(dir: string): string[] {
    const results: string[] = [];
    const walk = (d: string) => {
      const files = fs.readdirSync(d);
      for (const f of files) {
        const full = path.join(d, f);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (stat.isFile()) {
          results.push(full);
        }
      }
    };
    walk(dir);
    return results;
  }
}

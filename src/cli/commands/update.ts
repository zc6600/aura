import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import picocolors from 'picocolors';
import * as GlobalConfig from '../../utils/globalConfig.js';
import * as PathResolver from '../../utils/pathResolver.js';
import * as ProjectRegistry from '../../utils/projectRegistry.js';
import { errorMessage } from '../../utils/typing.js';
import * as UI from '../ui.js';
import { Template } from './template.js';

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

export class Update {
  public static async framework(
    options: { force?: boolean } = {},
  ): Promise<void> {
    console.log('🔄 Detecting Aura Framework codebase...');
    const rootDir = findPackageRoot(__dirname);
    console.log(`📍 Found framework home at: ${rootDir}`);
    console.log('📡 Fetching latest updates from GitHub...');

    try {
      await execa('git', ['fetch', '--all'], { cwd: rootDir });
      const { stdout: rawBranch } = await execa(
        'git',
        ['branch', '--show-current'],
        { cwd: rootDir },
      );
      const branch = rawBranch.trim();
      if (!branch) {
        console.log(
          picocolors.yellow(
            '⚠️ Warning: Repository is in a detached HEAD state. Cannot determine current branch to merge updates.',
          ),
        );
        console.log(
          'Skipping git merge update. Proceeding with dependency updates and rebuild...',
        );
      } else {
        if (options.force) {
          console.log(
            `📥 Force updating branch [${branch}] from origin/${branch}...`,
          );
          await execa('git', ['reset', '--hard', `origin/${branch}`], {
            cwd: rootDir,
          });
        } else {
          console.log(`📥 Pulling updates for branch [${branch}]...`);
          await execa('git', ['merge', `origin/${branch}`], {
            cwd: rootDir,
          });
        }
      }

      console.log('📦 Installing/updating dependencies (npm install)...');
      await execa('npm', ['install'], { cwd: rootDir, stdio: 'inherit' });

      console.log('🏗️ Rebuilding TypeScript outputs (tsup)...');
      await execa('npm', ['run', 'build'], { cwd: rootDir, stdio: 'inherit' });

      console.log(
        '\nAutomatically triggering template sync to global repository...',
      );
      await Template.sync();

      console.log(
        `\n${picocolors.green('✨ Aura Framework successfully updated to the latest GitHub version!')}`,
      );
    } catch (_error: unknown) {
      console.log(`\n${picocolors.red('❌ Automatic Git update failed.')}`);
      console.log('Please manually update in your source directory:');
      console.log(
        picocolors.cyan(`  cd "${rootDir}" && git pull && npm run build`),
      );
    }
  }

  public static async status(): Promise<void> {
    const auraDir = Update.ensureWorkspace();
    const globalRepo = GlobalConfig.repoPath();

    if (!fs.existsSync(globalRepo)) {
      throw new UI.WorkspaceError(
        `Global repo not found at ${globalRepo}. Run 'aura new' to initialize.`,
      );
    }

    // Fetch latest remote tracking branch state
    await GlobalConfig.gitRun(auraDir, 'fetch', 'origin');

    console.log('📊 Template Update Status\n');
    console.log('='.repeat(60));

    const localCommit = await GlobalConfig.gitRun(auraDir, 'rev-parse', 'HEAD');
    const localLog = await GlobalConfig.gitRun(
      auraDir,
      'log',
      '--oneline',
      '-1',
    );

    const remoteCommit = await GlobalConfig.gitRun(
      globalRepo,
      'rev-parse',
      'HEAD',
    );
    const remoteLog = await GlobalConfig.gitRun(
      globalRepo,
      'log',
      '--oneline',
      '-1',
    );

    console.log('Local (.aura-workspace):');
    console.log(`  Commit: ${localCommit.stdout.trim()}`);
    console.log(`  Message: ${localLog.stdout.trim()}`);

    console.log('\nGlobal (~/.aura-framework/repo):');
    console.log(`  Commit: ${remoteCommit.stdout.trim()}`);
    console.log(`  Message: ${remoteLog.stdout.trim()}`);

    if (localCommit.stdout.trim() === remoteCommit.stdout.trim()) {
      console.log(`\n${picocolors.green('✓ Your templates are up to date!')}`);
    } else {
      console.log(
        `\n${picocolors.yellow('⚠️  Updates available from global repo!')}`,
      );
      console.log("Run 'aura pull' or 'aura update merge' to update.");

      const diff = await GlobalConfig.gitRun(
        auraDir,
        'log',
        'HEAD..origin/main',
        '--oneline',
      );
      if (diff.success && diff.stdout.trim().length > 0) {
        console.log('\nPending commits:');
        console.log(diff.stdout);
      }
    }
  }

  public static async all(options: { merge?: boolean } = {}): Promise<void> {
    const projects = ProjectRegistry.registeredProjects();
    const keys = Object.keys(projects);

    if (keys.length === 0) {
      console.log('No registered projects found.');
      return;
    }

    console.log(`🔄 Updating ${keys.length} project(s)...\n`);
    console.log('='.repeat(60));

    let successCount = 0;
    let failCount = 0;

    for (const name of keys) {
      const pPath = projects[name];
      console.log(`\n${picocolors.bold(`[${name}]`)} ${pPath}`);

      let auraDir = path.join(pPath, '.aura-workspace');
      if (!fs.existsSync(auraDir) || !fs.statSync(auraDir).isDirectory()) {
        auraDir = path.join(pPath, '.aura');
      }
      if (!fs.existsSync(auraDir) || !fs.statSync(auraDir).isDirectory()) {
        console.log(
          `  ${picocolors.yellow('⚠️  Skipped (no .aura-workspace directory)')}`,
        );
        continue;
      }

      let configBackup: string | null = null;
      let tmpDir: string | null = null;
      try {
        const configPath = PathResolver.resolveConfigPath(auraDir);
        if (configPath && fs.existsSync(configPath)) {
          tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-update-'));
          configBackup = path.join(tmpDir, 'config.yml');
          fs.copyFileSync(configPath, configBackup);
          console.log(`  ${picocolors.yellow('⚠️  Backed up user config.yml')}`);
        }

        if (options.merge) {
          console.log('  Merging updates...');
          const ok = await Update.mergeProject(name, auraDir);
          if (ok) successCount++;
          else failCount++;
        } else {
          console.log('  Pulling updates...');
          const res = await GlobalConfig.gitRun(
            auraDir,
            'pull',
            '--no-edit',
            'origin',
            'main',
          );
          if (res.success) {
            console.log(`  ${picocolors.green('✓ Updated')}`);
            successCount++;
          } else {
            const firstLine = res.stderr.split('\n')[0] || 'Unknown error';
            console.log(`  ${picocolors.red(`✗ Failed: ${firstLine}`)}`);
            failCount++;
          }
        }

        if (configBackup && configPath) {
          GlobalConfig.restoreAndMergeConfig(configBackup, configPath);
        }
      } catch (e: unknown) {
        console.log(`  ${picocolors.red(`✗ Error: ${errorMessage(e)}`)}`);
        failCount++;
      } finally {
        if (tmpDir) {
          try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          } catch {}
        } else if (configBackup && fs.existsSync(configBackup)) {
          try {
            fs.unlinkSync(configBackup);
          } catch {}
        }
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('Summary:');
    console.log(`  ${picocolors.green(`✓ Success: ${successCount}`)}`);
    console.log(`  ${picocolors.red(`✗ Failed: ${failCount}`)}`);
  }

  public static async project(
    pathOrName: string,
    options: { merge?: boolean } = {},
  ): Promise<void> {
    const projects = ProjectRegistry.registeredProjects();

    let auraDir: string | null = null;
    let projectName: string | null = null;
    let projectPath: string | null = null;

    if (projects[pathOrName]) {
      projectName = pathOrName;
      projectPath = projects[pathOrName];
      let resolvedAura = path.join(projectPath, '.aura-workspace');
      if (
        !fs.existsSync(resolvedAura) ||
        !fs.statSync(resolvedAura).isDirectory()
      ) {
        resolvedAura = path.join(projectPath, '.aura');
      }
      auraDir = resolvedAura;
    } else {
      const normalizedPath = path.resolve(pathOrName);
      const keys = Object.keys(projects);
      for (const name of keys) {
        if (path.resolve(projects[name]) === normalizedPath) {
          projectName = name;
          projectPath = projects[name];
          let resolvedAura = path.join(projectPath, '.aura-workspace');
          if (
            !fs.existsSync(resolvedAura) ||
            !fs.statSync(resolvedAura).isDirectory()
          ) {
            resolvedAura = path.join(projectPath, '.aura');
          }
          auraDir = resolvedAura;
          break;
        }
      }

      if (
        !auraDir &&
        fs.existsSync(normalizedPath) &&
        fs.statSync(normalizedPath).isDirectory()
      ) {
        const potentialAuraNew = path.join(normalizedPath, '.aura-workspace');
        if (
          fs.existsSync(potentialAuraNew) &&
          fs.statSync(potentialAuraNew).isDirectory()
        ) {
          projectName = path.basename(normalizedPath);
          projectPath = normalizedPath;
          auraDir = potentialAuraNew;
        } else {
          const potentialAuraOld = path.join(normalizedPath, '.aura');
          if (
            fs.existsSync(potentialAuraOld) &&
            fs.statSync(potentialAuraOld).isDirectory()
          ) {
            projectName = path.basename(normalizedPath);
            projectPath = normalizedPath;
            auraDir = potentialAuraOld;
          }
        }
      }
    }

    if (!auraDir || !fs.existsSync(auraDir) || !projectName) {
      throw new UI.WorkspaceError(
        `Project '${pathOrName}' not found or has no .aura-workspace directory`,
      );
    }

    console.log(`${picocolors.bold(`[${projectName}]`)} ${projectPath}\n`);

    let configBackup: string | null = null;
    let tmpDir: string | null = null;
    try {
      const configPath = PathResolver.resolveConfigPath(auraDir);
      if (configPath && fs.existsSync(configPath)) {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-update-'));
        configBackup = path.join(tmpDir, 'config.yml');
        fs.copyFileSync(configPath, configBackup);
        console.log(`  ${picocolors.yellow('⚠️  Backed up user config.yml')}`);
      }

      if (options.merge) {
        console.log('  Merging updates...');
        await Update.mergeProject(projectName, auraDir);
      } else {
        console.log('  Pulling updates...');
        const res = await GlobalConfig.gitRun(
          auraDir,
          'pull',
          '--no-edit',
          'origin',
          'main',
        );
        if (res.success) {
          console.log(`  ${picocolors.green('✓ Updated')}`);
        } else {
          const firstLine = res.stderr.split('\n')[0] || 'Unknown error';
          console.log(`  ${picocolors.red(`✗ Failed: ${firstLine}`)}`);
        }
      }

      if (configBackup && configPath) {
        GlobalConfig.restoreAndMergeConfig(configBackup, configPath);
      }
    } catch (e: unknown) {
      console.log(`  ${picocolors.red(`✗ Error: ${errorMessage(e)}`)}`);
    } finally {
      if (tmpDir) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}
      } else if (configBackup && fs.existsSync(configBackup)) {
        try {
          fs.unlinkSync(configBackup);
        } catch {}
      }
    }
  }

  public static async current(
    options: { merge?: boolean } = {},
  ): Promise<void> {
    const auraDir = Update.ensureWorkspace();
    const projectPath = path.dirname(auraDir);
    const projectName = path.basename(projectPath);

    console.log(`${picocolors.bold(`[${projectName}]`)} ${projectPath}\n`);

    let configBackup: string | null = null;
    let tmpDir: string | null = null;
    try {
      const configPath = PathResolver.resolveConfigPath(auraDir);
      if (configPath && fs.existsSync(configPath)) {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-update-'));
        configBackup = path.join(tmpDir, 'config.yml');
        fs.copyFileSync(configPath, configBackup);
        console.log(`  ${picocolors.yellow('⚠️  Backed up user config.yml')}`);
      }

      if (options.merge) {
        console.log('  Merging updates...');
        await Update.mergeProject(projectName, auraDir);
      } else {
        console.log('  Pulling updates...');
        const res = await GlobalConfig.gitRun(
          auraDir,
          'pull',
          '--no-edit',
          'origin',
          'main',
        );
        if (res.success) {
          console.log(`  ${picocolors.green('✓ Updated')}`);
        } else {
          const firstLine = res.stderr.split('\n')[0] || 'Unknown error';
          console.log(`  ${picocolors.red(`✗ Failed: ${firstLine}`)}`);
        }
      }

      if (configBackup && configPath) {
        GlobalConfig.restoreAndMergeConfig(configBackup, configPath);
      }
    } catch (e: unknown) {
      console.log(`  ${picocolors.red(`✗ Error: ${errorMessage(e)}`)}`);
    } finally {
      if (tmpDir) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}
      } else if (configBackup && fs.existsSync(configBackup)) {
        try {
          fs.unlinkSync(configBackup);
        } catch {}
      }
    }
  }

  public static async merge(
    options: { stash?: boolean; force?: boolean } = {},
  ): Promise<void> {
    const auraDir = Update.ensureWorkspace();

    console.log('🔀 Merging template updates from global repo...');
    console.log('='.repeat(60));

    let configBackup: string | null = null;
    let tmpDir: string | null = null;

    try {
      const configPath = PathResolver.resolveConfigPath(auraDir);
      if (configPath && fs.existsSync(configPath)) {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-update-'));
        configBackup = path.join(tmpDir, 'config.yml');
        fs.copyFileSync(configPath, configBackup);
        console.log(`  ${picocolors.yellow('⚠️  Backed up user config.yml')}`);
      }

      // Fetch latest remote tracking branch state
      await GlobalConfig.gitRun(auraDir, 'fetch', 'origin');

      const statusOut = await GlobalConfig.gitRun(
        auraDir,
        'status',
        '--porcelain',
      );
      const hasChanges = statusOut.stdout.trim().length > 0;

      if (hasChanges) {
        if (options.force) {
          console.log(
            picocolors.yellow(
              '⚠️  Force merging (remote changes will override local)...',
            ),
          );
          const res = await GlobalConfig.gitRun(
            auraDir,
            'merge',
            '-X',
            'theirs',
            'origin/main',
          );
          if (res.success) {
            console.log(picocolors.green('✓ Force merge completed!'));
            if (res.stdout.trim()) console.log(res.stdout);
          } else {
            console.error(picocolors.red('⛔️ Merge failed!'));
            console.error(res.stderr);
          }
          if (configBackup && configPath) {
            GlobalConfig.restoreAndMergeConfig(configBackup, configPath);
          }
          return;
        } else if (options.stash) {
          await GlobalConfig.gitRun(auraDir, 'stash');
          console.log(picocolors.green('✓ Changes stashed.'));
        } else {
          console.log(
            picocolors.yellow(
              `⚠️  You have uncommitted changes in ${path.basename(auraDir)}/`,
            ),
          );
          console.log('\nOptions:');
          console.log('  1. Commit changes first (recommended)');
          console.log('  2. Use --stash to temporarily save changes');
          console.log('  3. Use --force to override with remote changes');
          throw new UI.CliError(
            'Merge cancelled: uncommitted changes present. Use --stash or --force.',
          );
        }
      }

      const res = await GlobalConfig.gitRun(
        auraDir,
        'pull',
        '--no-edit',
        'origin',
        'main',
      );
      if (res.success) {
        console.log(
          picocolors.green('✓ Successfully merged template updates!'),
        );
        console.log(res.stdout);

        if (options.stash) {
          const stashRes = await GlobalConfig.gitRun(auraDir, 'stash', 'pop');
          if (stashRes.success) {
            console.log(picocolors.green('✓ Stashed changes restored.'));
          } else {
            console.log(
              picocolors.yellow(
                '⚠️  Failed to pop stash (may need manual resolution)',
              ),
            );
          }
        }
      } else {
        console.error(picocolors.red('⛔️ Merge conflicts detected!'));
        console.log(
          `\nPlease resolve conflicts manually in ${path.basename(auraDir)}/ directory`,
        );
        console.log('After resolving, run:');
        console.log(
          `  cd ${path.basename(auraDir)} && git add . && git commit -m 'Resolved merge conflicts'`,
        );
      }

      if (configBackup && configPath) {
        GlobalConfig.restoreAndMergeConfig(configBackup, configPath);
      }
    } finally {
      if (tmpDir) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}
      } else if (configBackup && fs.existsSync(configBackup)) {
        try {
          fs.unlinkSync(configBackup);
        } catch {}
      }
    }
  }

  private static async mergeProject(
    _name: string,
    auraDir: string,
  ): Promise<boolean> {
    const res = await GlobalConfig.gitRun(
      auraDir,
      'pull',
      '--no-edit',
      'origin',
      'main',
    );
    if (res.success) {
      console.log(`  ${picocolors.green('✓ Updated')}`);
      return true;
    } else {
      if (res.stderr.includes('CONFLICT')) {
        console.log(
          `  ${picocolors.red('✗ Merge conflicts (requires manual resolution)')}`,
        );
      } else {
        const firstLine = res.stderr.split('\n')[0] || 'Unknown error';
        console.log(`  ${picocolors.red(`✗ Failed: ${firstLine}`)}`);
      }
      return false;
    }
  }

  private static ensureWorkspace(): string {
    try {
      return PathResolver.ensureWorkspace(process.cwd());
    } catch {
      throw new UI.WorkspaceError('Not in an Aura workspace.');
    }
  }
}

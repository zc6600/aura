import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import picocolors from 'picocolors';
import yaml from 'yaml';
import * as PathResolver from '../../utils/pathResolver.js';
import * as GlobalConfig from '../../utils/globalConfig.js';
import * as ProjectRegistry from '../../utils/projectRegistry.js';
import { Template } from './template.js';

export class Update {
  public static async framework(options: { force?: boolean } = {}): Promise<void> {
    console.log('🔄 Updating Aura Framework...');
    console.log('In TypeScript version, please run:');
    console.log(picocolors.cyan('  npm update -g aura-cli'));
    console.log('or if developing locally, run:');
    console.log(picocolors.cyan('  npm run build'));
    console.log('\nAutomatically triggering template sync to global repository...');
    await Template.sync();
  }

  public static async status(): Promise<void> {
    const auraDir = this.ensureWorkspace();
    const globalRepo = GlobalConfig.repoPath();

    if (!fs.existsSync(globalRepo)) {
      console.error(picocolors.red(`⛔️ Global repo not found at ${globalRepo}`));
      process.exit(1);
    }

    console.log('📊 Template Update Status\n');
    console.log('='.repeat(60));

    const localCommit = await GlobalConfig.gitRun(auraDir, 'rev-parse', 'HEAD');
    const localLog = await GlobalConfig.gitRun(auraDir, 'log', '--oneline', '-1');

    const remoteCommit = await GlobalConfig.gitRun(globalRepo, 'rev-parse', 'HEAD');
    const remoteLog = await GlobalConfig.gitRun(globalRepo, 'log', '--oneline', '-1');

    console.log('Local (.aura):');
    console.log(`  Commit: ${localCommit.stdout.trim()}`);
    console.log(`  Message: ${localLog.stdout.trim()}`);

    console.log('\nGlobal (~/.aura/repo):');
    console.log(`  Commit: ${remoteCommit.stdout.trim()}`);
    console.log(`  Message: ${remoteLog.stdout.trim()}`);

    if (localCommit.stdout.trim() === remoteCommit.stdout.trim()) {
      console.log(`\n${picocolors.green('✓ Your templates are up to date!')}`);
    } else {
      console.log(`\n${picocolors.yellow('⚠️  Updates available from global repo!')}`);
      console.log("Run 'aura pull' or 'aura update merge' to update.");

      const diff = await GlobalConfig.gitRun(auraDir, 'log', 'HEAD..origin/main', '--oneline');
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

      const auraDir = path.join(pPath, '.aura');
      if (!fs.existsSync(auraDir) || !fs.statSync(auraDir).isDirectory()) {
        console.log(`  ${picocolors.yellow('⚠️  Skipped (no .aura directory)')}`);
        continue;
      }

      try {
        if (options.merge) {
          console.log('  Merging updates...');
          const ok = await this.mergeProject(name, auraDir);
          if (ok) successCount++; else failCount++;
        } else {
          console.log('  Pulling updates...');
          const res = await GlobalConfig.gitRun(auraDir, 'pull', '--no-edit', 'origin', 'main');
          if (res.success) {
            console.log(`  ${picocolors.green('✓ Updated')}`);
            successCount++;
          } else {
            const firstLine = res.stderr.split('\n')[0] || 'Unknown error';
            console.log(`  ${picocolors.red(`✗ Failed: ${firstLine}`)}`);
            failCount++;
          }
        }
      } catch (e: any) {
        console.log(`  ${picocolors.red(`✗ Error: ${e.message}`)}`);
        failCount++;
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('Summary:');
    console.log(`  ${picocolors.green(`✓ Success: ${successCount}`)}`);
    console.log(`  ${picocolors.red(`✗ Failed: ${failCount}`)}`);
  }

  public static async project(pathOrName: string, options: { merge?: boolean } = {}): Promise<void> {
    const projects = ProjectRegistry.registeredProjects();

    let auraDir: string | null = null;
    let projectName: string | null = null;
    let projectPath: string | null = null;

    if (projects[pathOrName]) {
      projectName = pathOrName;
      projectPath = projects[pathOrName];
      auraDir = path.join(projectPath, '.aura');
    } else {
      const normalizedPath = path.resolve(pathOrName);
      const keys = Object.keys(projects);
      for (const name of keys) {
        if (path.resolve(projects[name]) === normalizedPath) {
          projectName = name;
          projectPath = projects[name];
          auraDir = path.join(projectPath, '.aura');
          break;
        }
      }

      if (!auraDir && fs.existsSync(normalizedPath) && fs.statSync(normalizedPath).isDirectory()) {
        const potentialAura = path.join(normalizedPath, '.aura');
        if (fs.existsSync(potentialAura) && fs.statSync(potentialAura).isDirectory()) {
          projectName = path.basename(normalizedPath);
          projectPath = normalizedPath;
          auraDir = potentialAura;
        }
      }
    }

    if (!auraDir || !fs.existsSync(auraDir)) {
      console.error(picocolors.red(`⛔️ Error: Project '${pathOrName}' not found or has no .aura directory`));
      process.exit(1);
    }

    console.log(`${picocolors.bold(`[${projectName}]`)} ${projectPath}\n`);

    let configBackup: string | null = null;
    try {
      const configPath = PathResolver.resolveConfigPath(auraDir);
      if (fs.existsSync(configPath)) {
        configBackup = path.join(os.tmpdir(), `aura_config_backup_${process.pid}.yml`);
        fs.copyFileSync(configPath, configBackup);
        console.log(`  ${picocolors.yellow('⚠️  Backed up user config.yml')}`);
      }

      if (options.merge) {
        console.log('  Merging updates...');
        await this.mergeProject(projectName!, auraDir);
      } else {
        console.log('  Pulling updates...');
        const res = await GlobalConfig.gitRun(auraDir, 'pull', '--no-edit', 'origin', 'main');
        if (res.success) {
          console.log(`  ${picocolors.green('✓ Updated')}`);
        } else {
          const firstLine = res.stderr.split('\n')[0] || 'Unknown error';
          console.log(`  ${picocolors.red(`✗ Failed: ${firstLine}`)}`);
        }
      }

      if (configBackup) {
        this.restoreAndMergeConfig(configBackup, configPath);
      }
    } catch (e: any) {
      console.log(`  ${picocolors.red(`✗ Error: ${e.message}`)}`);
      if (configBackup && fs.existsSync(configBackup)) {
        fs.unlinkSync(configBackup);
      }
    }
  }

  public static async current(options: { merge?: boolean } = {}): Promise<void> {
    const auraDir = this.ensureWorkspace();
    const projectPath = path.dirname(auraDir);
    const projectName = path.basename(projectPath);

    console.log(`${picocolors.bold(`[${projectName}]`)} ${projectPath}\n`);

    let configBackup: string | null = null;
    try {
      const configPath = PathResolver.resolveConfigPath(auraDir);
      if (fs.existsSync(configPath)) {
        configBackup = path.join(os.tmpdir(), `aura_config_backup_${process.pid}.yml`);
        fs.copyFileSync(configPath, configBackup);
        console.log(`  ${picocolors.yellow('⚠️  Backed up user config.yml')}`);
      }

      if (options.merge) {
        console.log('  Merging updates...');
        await this.mergeProject(projectName, auraDir);
      } else {
        console.log('  Pulling updates...');
        const res = await GlobalConfig.gitRun(auraDir, 'pull', '--no-edit', 'origin', 'main');
        if (res.success) {
          console.log(`  ${picocolors.green('✓ Updated')}`);
        } else {
          const firstLine = res.stderr.split('\n')[0] || 'Unknown error';
          console.log(`  ${picocolors.red(`✗ Failed: ${firstLine}`)}`);
        }
      }

      if (configBackup) {
        this.restoreAndMergeConfig(configBackup, configPath);
      }
    } catch (e: any) {
      console.log(`  ${picocolors.red(`✗ Error: ${e.message}`)}`);
      if (configBackup && fs.existsSync(configBackup)) {
        fs.unlinkSync(configBackup);
      }
    }
  }

  public static async merge(options: { stash?: boolean; force?: boolean } = {}): Promise<void> {
    const auraDir = this.ensureWorkspace();

    console.log('🔀 Merging template updates from global repo...');
    console.log('='.repeat(60));

    const statusOut = await GlobalConfig.gitRun(auraDir, 'status', '--porcelain');
    const hasChanges = statusOut.stdout.trim().length > 0;

    if (hasChanges) {
      if (options.force) {
        console.log(picocolors.yellow('⚠️  Force merging (remote changes will override local)...'));
        const res = await GlobalConfig.gitRun(auraDir, 'merge', '-X', 'theirs', 'origin/main');
        if (res.success) {
          console.log(picocolors.green('✓ Force merge completed!'));
          if (res.stdout.trim()) console.log(res.stdout);
        } else {
          console.error(picocolors.red('⛔️ Merge failed!'));
          console.error(res.stderr);
        }
        return;
      } else if (options.stash) {
        await GlobalConfig.gitRun(auraDir, 'stash');
        console.log(picocolors.green('✓ Changes stashed.'));
      } else {
        console.log(picocolors.yellow('⚠️  You have uncommitted changes in .aura/'));
        console.log('\nOptions:');
        console.log('  1. Commit changes first (recommended)');
        console.log('  2. Use --stash to temporarily save changes');
        console.log('  3. Use --force to override with remote changes');
        console.log(`\n${picocolors.red('⛔️ Merge cancelled.')}`);
        process.exit(1);
      }
    }

    const res = await GlobalConfig.gitRun(auraDir, 'pull', '--no-edit', 'origin', 'main');
    if (res.success) {
      console.log(picocolors.green('✓ Successfully merged template updates!'));
      console.log(res.stdout);

      if (options.stash) {
        const stashRes = await GlobalConfig.gitRun(auraDir, 'stash', 'pop');
        if (stashRes.success) {
          console.log(picocolors.green('✓ Stashed changes restored.'));
        } else {
          console.log(picocolors.yellow('⚠️  Failed to pop stash (may need manual resolution)'));
        }
      }
    } else {
      console.error(picocolors.red('⛔️ Merge conflicts detected!'));
      console.log('\nPlease resolve conflicts manually in .aura/ directory');
      console.log('After resolving, run:');
      console.log("  cd .aura && git add . && git commit -m 'Resolved merge conflicts'");
    }
  }

  private static async mergeProject(name: string, auraDir: string): Promise<boolean> {
    const res = await GlobalConfig.gitRun(auraDir, 'pull', '--no-edit', 'origin', 'main');
    if (res.success) {
      console.log(`  ${picocolors.green('✓ Updated')}`);
      return true;
    } else {
      if (res.stderr.includes('CONFLICT')) {
        console.log(`  ${picocolors.red('✗ Merge conflicts (requires manual resolution)')}`);
      } else {
        const firstLine = res.stderr.split('\n')[0] || 'Unknown error';
        console.log(`  ${picocolors.red(`✗ Failed: ${firstLine}`)}`);
      }
      return false;
    }
  }

  private static restoreAndMergeConfig(configBackup: string, configPath: string): void {
    if (!fs.existsSync(configBackup)) return;

    try {
      const backupCfg = yaml.parse(fs.readFileSync(configBackup, 'utf-8')) || {};
      const newCfg = yaml.parse(fs.readFileSync(configPath, 'utf-8')) || {};

      // Deep merge
      const merged = { ...newCfg, ...backupCfg };
      if (newCfg.llm && backupCfg.llm) {
        merged.llm = { ...newCfg.llm, ...backupCfg.llm };
      }
      if (newCfg.state_management && backupCfg.state_management) {
        merged.state_management = { ...newCfg.state_management, ...backupCfg.state_management };
      }
      if (newCfg.ralph && backupCfg.ralph) {
        merged.ralph = { ...newCfg.ralph, ...backupCfg.ralph };
      }

      fs.writeFileSync(configPath, yaml.stringify(merged), 'utf-8');
      console.log(`  ${picocolors.green('✓ Restored and merged user config.yml')}`);
    } catch (e: any) {
      fs.copyFileSync(configBackup, configPath);
      console.log(`  ${picocolors.yellow(`⚠️  Merge failed: ${e.message}. Restored user config.yml from backup.`)}`);
    } finally {
      try {
        fs.unlinkSync(configBackup);
      } catch {}
    }
  }

  private static ensureWorkspace(): string {
    try {
      return PathResolver.ensureWorkspace(process.cwd());
    } catch {
      console.error(picocolors.red('⛔️ Error: Not in an Aura workspace.'));
      process.exit(1);
    }
  }
}

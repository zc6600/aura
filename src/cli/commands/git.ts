import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import picocolors from 'picocolors';
import * as GlobalConfig from '../../utils/globalConfig.js';
import * as PathResolver from '../../utils/pathResolver.js';
import * as UI from '../ui.js';

export class Git {
  public static async add(paths: string[]): Promise<void> {
    const auraDir = Git.ensureWorkspace();

    const resolvedPaths = paths.map((p) => {
      const absP = path.resolve(p);
      if (absP === auraDir || absP.startsWith(auraDir + path.sep)) {
        return path.relative(auraDir, absP);
      }
      return p;
    });

    const res = await GlobalConfig.gitRun(auraDir, 'add', ...resolvedPaths);
    if (res.success) {
      console.log(
        picocolors.green('Successfully staged changes inside .aura-workspace.'),
      );
    } else {
      console.error(picocolors.red(`Error staging changes:\n${res.stderr}`));
    }
  }

  public static async commit(message: string): Promise<void> {
    const auraDir = Git.ensureWorkspace();
    const res = await GlobalConfig.gitRun(auraDir, 'commit', '-m', message);
    if (res.success) {
      console.log(
        picocolors.green(
          'Successfully committed changes inside .aura-workspace:',
        ),
      );
      console.log(res.stdout);
    } else {
      console.error(picocolors.red(`Error committing changes:\n${res.stderr}`));
    }
  }

  public static async status(): Promise<void> {
    const auraDir = Git.ensureWorkspace();
    const res = await GlobalConfig.gitRun(auraDir, 'status');
    console.log(res.stdout);
    if (res.stderr) {
      console.error(res.stderr);
    }
  }

  public static async sync(): Promise<void> {
    const auraDir = Git.ensureWorkspace();
    console.log(
      'Syncing changes back to the global repository (~/.aura-framework/repo)...',
    );
    const res = await GlobalConfig.gitRun(auraDir, 'push', 'origin', 'main');
    if (res.success) {
      console.log(
        picocolors.green('Successfully synced local changes to global repo!'),
      );
    } else {
      console.error(picocolors.red(`Error syncing changes:\n${res.stderr}`));
    }
  }

  public static async pull(): Promise<void> {
    const auraDir = Git.ensureWorkspace();
    console.log(
      'Pulling updates from the global repository (~/.aura-framework/repo)...',
    );

    let configBackup: string | null = null;
    let tmpDir: string | null = null;
    const configPath = PathResolver.resolveConfigPath(auraDir);

    try {
      if (configPath && fs.existsSync(configPath)) {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-git-pull-'));
        configBackup = path.join(tmpDir, 'config.yml');
        fs.copyFileSync(configPath, configBackup);
        console.log(`  ${picocolors.yellow('⚠️  Backed up user config.yml')}`);
      }

      const res = await GlobalConfig.gitRun(auraDir, 'pull', 'origin', 'main');
      if (res.success) {
        console.log(
          picocolors.green('Successfully pulled updates from global repo!'),
        );
        console.log(res.stdout);
      } else {
        console.error(picocolors.red(`Error pulling updates:\n${res.stderr}`));
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

  public static async log(): Promise<void> {
    const auraDir = Git.ensureWorkspace();
    const res = await GlobalConfig.gitRun(auraDir, 'log', '-n', '10');
    console.log(res.stdout);
    if (res.stderr) {
      console.error(res.stderr);
    }
  }

  public static async diff(): Promise<void> {
    const auraDir = Git.ensureWorkspace();
    const res = await GlobalConfig.gitRun(auraDir, 'diff');
    console.log(res.stdout);
    if (res.stderr) {
      console.error(res.stderr);
    }
  }

  public static async checkout(branchName: string): Promise<void> {
    const auraDir = Git.ensureWorkspace();
    const res = await GlobalConfig.gitRun(auraDir, 'checkout', branchName);
    if (res.success) {
      console.log(picocolors.green(`Successfully checked out: ${branchName}`));
    } else {
      console.error(picocolors.red(`Error checkout:\n${res.stderr}`));
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

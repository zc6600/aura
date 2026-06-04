import fs from 'fs';
import path from 'path';
import { execa } from 'execa';
import * as PathResolver from '../../utils/pathResolver.js';

export class ShadowBackup {
  public static readonly MAX_FILE_SIZE = 1024 * 1024; // 1MB

  private projectPath: string;
  private envPath: string;
  private shadowPath: string;
  private shadowGit: string;

  constructor(projectPath: string) {
    this.projectPath = path.resolve(projectPath);
    this.envPath = PathResolver.environmentPath(this.projectPath) || this.projectPath;
    this.shadowPath = path.join(this.envPath, 'shadow');
    this.shadowGit = path.join(this.shadowPath, '.git');
  }

  public async recordChanges(toolName: string, toolArgs: any = {}): Promise<void> {
    try {
      await this.ensureShadowGitInitialized();

      let changedFiles: string[] = [];

      if (fs.existsSync(path.join(this.projectPath, '.git'))) {
        try {
          const { stdout } = await execa('git', ['status', '--porcelain'], { cwd: this.projectPath });
          const lines = stdout.split('\n');
          for (const line of lines) {
            if (line.length > 3) {
              let filepath = line.substring(3).trim();
              if (filepath.startsWith('"') && filepath.endsWith('"')) {
                filepath = filepath.slice(1, -1);
              }
              changedFiles.push(filepath);
            }
          }
        } catch (e) {}
      } else {
        if (toolArgs && typeof toolArgs === 'object') {
          const filePath = toolArgs.file_path || toolArgs.path;
          if (filePath && String(filePath).trim()) {
            changedFiles.push(String(filePath).trim());
          }
        }
      }

      changedFiles = Array.from(new Set(changedFiles.filter(Boolean)));
      let copiedAny = false;

      for (const relPath of changedFiles) {
        const absSrc = path.resolve(this.projectPath, relPath);

        try {
          if (!fs.existsSync(absSrc) || !fs.statSync(absSrc).isFile()) {
            continue;
          }

          if (fs.statSync(absSrc).size > ShadowBackup.MAX_FILE_SIZE) {
            continue;
          }

          if (relPath.startsWith('.aura/') || relPath.includes('/.aura/')) {
            continue;
          }

          // Security resolve check
          const realSrc = fs.realpathSync(absSrc);
          const realProject = fs.realpathSync(this.projectPath);
          if (!realSrc.startsWith(realProject)) {
            continue;
          }

          // Check ignore
          if (fs.existsSync(path.join(this.projectPath, '.git'))) {
            try {
              await execa('git', ['check-ignore', relPath], { cwd: this.projectPath });
              continue; // Ignored
            } catch (e) {
              // Not ignored
            }
          }

          const absDest = path.resolve(this.shadowPath, relPath);
          fs.mkdirSync(path.dirname(absDest), { recursive: true });
          fs.copyFileSync(absSrc, absDest);
          copiedAny = true;
        } catch (e) {}
      }

      if (copiedAny) {
        const message = `[Aura] Tool execution: ${toolName}`;
        await execa('git', ['add', '.'], { cwd: this.shadowPath });
        await execa('git', ['commit', '-m', message], { cwd: this.shadowPath });
      }
    } catch (e: any) {
      console.warn(`ShadowBackup Error: ${e.message}`);
    }
  }

  private async ensureShadowGitInitialized(): Promise<void> {
    if (fs.existsSync(this.shadowGit)) {
      return;
    }

    fs.mkdirSync(this.shadowPath, { recursive: true });
    await execa('git', ['init'], { cwd: this.shadowPath });
    await execa('git', ['config', 'user.name', 'Aura Shadow Backup'], { cwd: this.shadowPath });
    await execa('git', ['config', 'user.email', 'shadow@aura-os.ai'], { cwd: this.shadowPath });

    const gitignorePath = path.join(this.shadowPath, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, '', 'utf-8');
    }

    await execa('git', ['add', '.gitignore'], { cwd: this.shadowPath });
    await execa('git', ['commit', '-m', 'Initial commit'], { cwd: this.shadowPath });
  }
}

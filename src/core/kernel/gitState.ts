import fs from 'fs';
import path from 'path';
import { execa } from 'execa';

export class GitState {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = path.resolve(projectPath);
  }

  public async snapshot(toolName: string, success = true): Promise<void> {
    if (!this.isGitRepo()) {
      return;
    }

    if (!success) {
      return;
    }

    const message = `[Aura] Tool execution: ${toolName}`;

    try {
      // Add all changes (except state/ which should be gitignored)
      await execa('git', ['add', '.'], { cwd: this.projectPath });

      // Check status
      const { stdout } = await execa('git', ['status', '--porcelain'], { cwd: this.projectPath });
      if (!stdout.trim()) {
        return;
      }

      // Commit
      await execa('git', ['commit', '-m', message], { cwd: this.projectPath });
    } catch (e) {
      // Fail-safe
    }
  }

  private isGitRepo(): boolean {
    return fs.existsSync(path.join(this.projectPath, '.git'));
  }
}

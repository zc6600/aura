import fs from 'node:fs';
import path from 'node:path';

export class TaskProvider {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  public provide(): string | null {
    const file = this.resolveTaskPath();
    if (!file) return null;

    try {
      const content = fs.readFileSync(file, 'utf-8').trim();
      if (!content) return null;
      return `# LONG-RUN TASK\n${content}`;
    } catch (_e) {
      return null;
    }
  }

  private resolveTaskPath(): string | null {
    let dir = path.resolve(this.projectPath);
    while (true) {
      const file = path.join(dir, 'task.md');
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        return file;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
    return null;
  }
}

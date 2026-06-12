import fs from 'node:fs';
import path from 'node:path';
import { readLastLinesSync } from '../../../utils/fsUtils.js';
import * as PathResolver from '../../../utils/pathResolver.js';

interface ProviderOptions {
  envPath?: string;
}

interface ProcessMetadata {
  pid: number;
  command: string;
  cwd: string;
  started_at: number;
  timeout_seconds?: number;
  stdout_file?: string;
  stderr_file?: string;
  status: string;
  exit_code?: number | null;
  ended_at?: number;
}

export class BackgroundProcessProvider {
  private projectPath: string;
  private envPath: string;

  constructor(projectPath: string, options: ProviderOptions = {}) {
    this.projectPath = path.resolve(projectPath);
    this.envPath =
      options.envPath ||
      PathResolver.environmentPath(this.projectPath) ||
      this.projectPath;
  }

  public provide(): string | null {
    const commandsDir = path.join(this.envPath, 'state', 'commands');
    if (
      !fs.existsSync(commandsDir) ||
      !fs.statSync(commandsDir).isDirectory()
    ) {
      return null;
    }

    let files: string[];
    try {
      files = fs.readdirSync(commandsDir);
    } catch {
      return null;
    }

    const activeList: string[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(commandsDir, file);
      try {
        const rawContent = fs.readFileSync(filePath, 'utf-8');
        const meta = JSON.parse(rawContent) as ProcessMetadata;
        if (!meta || typeof meta !== 'object' || typeof meta.pid !== 'number') {
          continue;
        }

        const pid = meta.pid;
        let isAlive = false;
        try {
          process.kill(pid, 0);
          isAlive = true;
        } catch (err: any) {
          isAlive = err.code === 'EPERM';
        }

        if (!isAlive && meta.status === 'running') {
          // Process exited since we last checked, update metadata
          meta.status = 'finished';
          meta.ended_at = Date.now() / 1000;
          try {
            fs.writeFileSync(filePath, JSON.stringify(meta, null, 2), 'utf-8');
          } catch {}
        }

        if (isAlive) {
          const command = meta.command || 'unknown';
          const elapsed = Math.max(
            0,
            Math.floor(Date.now() / 1000 - meta.started_at),
          );

          let logExcerpt = '';
          const stdoutFile =
            meta.stdout_file || path.join(commandsDir, `${pid}.out`);
          const stderrFile =
            meta.stderr_file || path.join(commandsDir, `${pid}.err`);

          const outContent = this.readLastLines(stdoutFile, 15);
          const errContent = this.readLastLines(stderrFile, 15);

          if (outContent.trim()) {
            logExcerpt += `[STDOUT]\n${outContent.trim()}`;
          }
          if (errContent.trim()) {
            if (logExcerpt) logExcerpt += '\n';
            logExcerpt += `[STDERR]\n${errContent.trim()}`;
          }

          let logBlock = '';
          if (logExcerpt) {
            logBlock = `\n    **Latest Output:**\n    \`\`\`\n${logExcerpt}\n    \`\`\``;
          }

          activeList.push(
            `- **PID**: ${pid}\n` +
              `  **Command**: \`${command}\`\n` +
              `  **Status**: Running (for ${elapsed} seconds)${logBlock}`,
          );
        }
      } catch {}
    }

    if (activeList.length === 0) {
      return null;
    }

    return `### Active Background Processes\nYou have the following running background processes:\n\n${activeList.join('\n\n')}`;
  }

  private readLastLines(filePath: string, maxLines: number): string {
    return readLastLinesSync(filePath, maxLines);
  }
}

import fs from 'node:fs';
import path from 'node:path';

export class WorkspaceProvider {
  public static readonly FILES: Record<string, string> = {
    soul: 'SOUL.md',
    agents: 'AGENTS.md',
    user: 'USER.md',
    tools: 'TOOLS.md',
    identity: 'IDENTITY.md',
    memory: 'MEMORY.md',
  };

  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  public provide(): string | null {
    const sections: string[] = [];

    for (const [key, filename] of Object.entries(WorkspaceProvider.FILES)) {
      const content = this.readFile(filename);
      if (!content) continue;

      let header = '';
      switch (key) {
        case 'soul':
          header = '# AGENT PERSONA (SOUL)';
          break;
        case 'agents':
          header = '# OPERATING INSTRUCTIONS';
          break;
        case 'user':
          header = '# USER CONTEXT';
          break;
        case 'tools':
          header = '# TOOL GUIDELINES';
          break;
        case 'identity':
          header = '# AGENT IDENTITY';
          break;
        case 'memory':
          header = '# LONG-TERM MEMORY';
          break;
        default:
          header = `# ${filename.toUpperCase()}`;
          break;
      }

      if (content.startsWith('# ')) {
        sections.push(content);
      } else {
        sections.push(`${header}\n${content}`);
      }
    }

    const dailyMemory = this.loadRecentDailyMemory();
    if (dailyMemory) {
      sections.push(dailyMemory);
    }

    if (sections.length === 0) {
      return null;
    }

    return sections.join('\n\n');
  }

  private readFile(filename: string): string | null {
    const candidates = [
      path.join(this.projectPath, filename),
      path.join(this.projectPath, '.aura', 'prompts', 'system', filename),
      path.join(this.projectPath, 'prompts', 'system', filename),
      path.join(this.projectPath, '.aura', 'prompts', filename),
      path.join(this.projectPath, 'prompts', filename),
      path.join(this.projectPath, '.aura', 'instructions', filename),
      path.join(this.projectPath, 'instructions', filename),
    ];

    const file = candidates.find(
      (f) => fs.existsSync(f) && fs.statSync(f).isFile(),
    );
    if (!file) return null;

    try {
      return fs.readFileSync(file, 'utf-8').trim();
    } catch (_e) {
      return null;
    }
  }

  private loadRecentDailyMemory(): string | null {
    const memoryDir = path.join(this.projectPath, 'memory');
    if (!fs.existsSync(memoryDir) || !fs.statSync(memoryDir).isDirectory()) {
      return null;
    }

    try {
      const files = fs
        .readdirSync(memoryDir)
        .filter((f) => f.endsWith('.md'))
        .sort();

      if (files.length === 0) return null;

      // Get last 2 logs
      const lastTwo = files.slice(-2);
      const contentList = lastTwo
        .map((f) => {
          const fullPath = path.join(memoryDir, f);
          try {
            const date = path.basename(f, '.md');
            const body = fs.readFileSync(fullPath, 'utf-8').trim();
            return `## Memory Log (${date})\n${body}`;
          } catch (_e) {
            return null;
          }
        })
        .filter(Boolean);

      if (contentList.length === 0) return null;

      return `# RECENT MEMORY LOGS\n${contentList.join('\n\n')}`;
    } catch (_e) {
      return null;
    }
  }
}

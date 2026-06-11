import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { ToolRegistry } from '../../kernel/registry.js';

interface SkillProviderOptions {
  envPath?: string;
}

export class SkillProvider {
  private projectPath: string;
  private envPath: string;
  private skillsPath: string;

  constructor(projectPath: string, options: SkillProviderOptions = {}) {
    this.projectPath = path.resolve(projectPath);
    this.envPath = options.envPath || this.projectPath;
    this.skillsPath = path.join(this.envPath, 'skills');
  }

  public provide(): string | null {
    let availableTools: string[] = [];
    try {
      const registry = new ToolRegistry(this.envPath);
      availableTools = registry.allTools();
    } catch (_e) {}

    let content = '';

    // 1. Read skills.md files
    const skillsMdFiles = [
      path.join(this.projectPath, 'skills', 'skills.md'),
      path.join(this.skillsPath, 'skills.md'),
    ];
    // Remove duplicates
    const uniqueSkillsMd = Array.from(new Set(skillsMdFiles));

    for (const file of uniqueSkillsMd) {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        try {
          const c = fs.readFileSync(file, 'utf-8').trim();
          if (c) {
            content += `${c}\n\n`;
          }
        } catch (_e) {}
      }
    }

    // 2. Scan individual SKILL.md files
    const baseDirs = Array.from(
      new Set([path.join(this.projectPath, 'skills'), this.skillsPath]),
    );
    const skillFiles: string[] = [];

    for (const baseDir of baseDirs) {
      if (fs.existsSync(baseDir) && fs.statSync(baseDir).isDirectory()) {
        try {
          const subdirs = fs.readdirSync(baseDir);
          for (const subdir of subdirs) {
            const skillFile = path.join(baseDir, subdir, 'SKILL.md');
            if (fs.existsSync(skillFile) && fs.statSync(skillFile).isFile()) {
              skillFiles.push(skillFile);
            }
          }
        } catch (_e) {}
      }
    }

    // Process unique SKILL.md
    const uniqueSkillFiles = Array.from(new Set(skillFiles));

    for (const skillFile of uniqueSkillFiles) {
      try {
        const raw = fs.readFileSync(skillFile, 'utf-8');
        // Parse frontmatter
        const fmMatch = raw.match(/^---\s+([\s\S]+?)\s+---/);
        if (fmMatch) {
          const frontmatter = fmMatch[1];
          const meta = yaml.parse(frontmatter) || {};

          const name = String(meta.name || '').trim();
          const desc = String(meta.description || '').trim();
          const requires: string[] = Array.isArray(meta.requires)
            ? meta.requires.map((x: string) => String(x).trim()).filter(Boolean)
            : [];

          // Parse requirements from body (Anthropic style)
          const reqHeaderMatch = raw.match(
            /(?:^|\n)##\s+(?:Requirements|Dependencies)\s*\n([\s\S]*?)(?=\n##|$)/,
          );
          if (reqHeaderMatch) {
            const lines = reqHeaderMatch[1].split('\n');
            for (const line of lines) {
              const depMatch = line.match(/-\s+`?(\w+)`?/);
              if (depMatch) {
                requires.push(depMatch[1]);
              }
            }
          }

          // Uniq requires
          const uniqueRequires = Array.from(new Set(requires));

          if (name) {
            const missing = uniqueRequires.filter(
              (t) => !availableTools.includes(t),
            );

            content += `\n\n### Skill: ${name}`;
            if (desc) {
              content += `\nDescription: ${desc}`;
            }
            if (uniqueRequires.length > 0) {
              content += `\nRequires: ${uniqueRequires.join(', ')}`;
            }
            if (missing.length > 0) {
              content += `\nMissing Requires: ${missing.join(', ')}`;
            }
            const relPath = path
              .relative(this.projectPath, skillFile)
              .replace(/\\/g, '/');
            content += `\nPath: ${relPath}`;

            // Scan subfolders
            const skillDir = path.dirname(skillFile);
            const subfolders = ['scripts', 'references', 'assets'];
            for (const sub of subfolders) {
              const folderPath = path.join(skillDir, sub);
              if (
                fs.existsSync(folderPath) &&
                fs.statSync(folderPath).isDirectory()
              ) {
                const files = fs
                  .readdirSync(folderPath)
                  .map((f) => path.basename(f))
                  .join(', ');
                if (files) {
                  const capitalized =
                    sub.charAt(0).toUpperCase() + sub.slice(1);
                  content += `\n${capitalized}: ${files}`;
                }
              }
            }
          }
        }
      } catch (_e) {}
    }

    return content.trim() ? content.trim() : null;
  }
}

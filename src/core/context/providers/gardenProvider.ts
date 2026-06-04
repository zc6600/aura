import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

export class GardenProvider {
  private projectPath: string;
  private envPath: string;
  private gardensPath: string;

  constructor(projectPath: string, options: any = {}) {
    this.projectPath = path.resolve(projectPath);
    this.envPath = options.envPath || this.projectPath;
    this.gardensPath = path.join(this.envPath, 'gardens');
  }

  public provide(): string | null {
    let content = '';

    // 1. Read garden.md files from standard locations
    const gardensMdFiles = [
      path.join(this.gardensPath, 'garden.md'),
      path.join(this.projectPath, 'garden.md'),
      path.join(this.projectPath, 'garden', 'garden.md'),
    ];
    const uniqueGardensMd = Array.from(new Set(gardensMdFiles));

    for (const file of uniqueGardensMd) {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        try {
          const c = fs.readFileSync(file, 'utf-8').trim();
          if (c) {
            const fmMatch = c.match(/\A---\s+([\s\S]+?)\s+---/);
            if (fmMatch) {
              const frontmatter = fmMatch[1];
              const meta = yaml.parse(frontmatter) || {};
              const name = String(meta.name || '').trim();
              const desc = String(meta.description || '').trim();
              const requires: string[] = Array.isArray(meta.requires)
                ? meta.requires.map((x: any) => String(x).trim()).filter(Boolean)
                : [];

              const reqHeaderMatch = c.match(/^##\s+(?:Requirements|Dependencies)\s*\n([\s\S]*?)(?=\n##|\Z)/m);
              if (reqHeaderMatch) {
                const lines = reqHeaderMatch[1].split('\n');
                for (const line of lines) {
                  const depMatch = line.match(/-\s+`?(\w+)`?/);
                  if (depMatch) {
                    requires.push(depMatch[1]);
                  }
                }
              }

              const uniqueRequires = Array.from(new Set(requires));

              if (name) {
                content += `\n\n### Garden: ${name}`;
                if (desc) {
                  content += `\nDescription: ${desc}`;
                }
                if (uniqueRequires.length > 0) {
                  content += `\nRequires: ${uniqueRequires.join(', ')}`;
                }
                const relPath = path.relative(this.projectPath, file).replace(/\\/g, '/');
                content += `\nPath: ${relPath}\n`;
              }

              const body = c.replace(/\A---\s+[\s\S]+?\s+---\n*/m, '');
              content += `\n${body}\n\n`;
            } else {
              content += `${c}\n\n`;
            }
          }
        } catch (e) {}
      }
    }

    // 2. Scan subfolders for individual GARDEN.md / garden.md files
    const baseDirs = Array.from(new Set([
      path.join(this.projectPath, 'gardens'),
      this.gardensPath,
      path.join(this.projectPath, 'garden'),
    ]));

    const gardenFiles: string[] = [];

    for (const baseDir of baseDirs) {
      if (fs.existsSync(baseDir) && fs.statSync(baseDir).isDirectory()) {
        try {
          const subdirs = fs.readdirSync(baseDir);
          for (const subdir of subdirs) {
            const subdirPath = path.join(baseDir, subdir);
            if (fs.existsSync(subdirPath) && fs.statSync(subdirPath).isDirectory()) {
              for (const filename of ['GARDEN.md', 'garden.md']) {
                const file = path.join(subdirPath, filename);
                if (fs.existsSync(file) && fs.statSync(file).isFile()) {
                  gardenFiles.push(file);
                }
              }
            }
          }
        } catch (e) {}
      }
    }

    const uniqueGardenFiles = Array.from(new Set(gardenFiles)).filter(f => !uniqueGardensMd.includes(f));

    for (const gardenFile of uniqueGardenFiles) {
      try {
        const raw = fs.readFileSync(gardenFile, 'utf-8');
        const fmMatch = raw.match(/\A---\s+([\s\S]+?)\s+---/);
        if (fmMatch) {
          const frontmatter = fmMatch[1];
          const meta = yaml.parse(frontmatter) || {};

          const name = String(meta.name || '').trim();
          const desc = String(meta.description || '').trim();
          const requires: string[] = Array.isArray(meta.requires)
            ? meta.requires.map((x: any) => String(x).trim()).filter(Boolean)
            : [];

          const reqHeaderMatch = raw.match(/^##\s+(?:Requirements|Dependencies)\s*\n([\s\S]*?)(?=\n##|\Z)/m);
          if (reqHeaderMatch) {
            const lines = reqHeaderMatch[1].split('\n');
            for (const line of lines) {
              const depMatch = line.match(/-\s+`?(\w+)`?/);
              if (depMatch) {
                requires.push(depMatch[1]);
              }
            }
          }

          const uniqueRequires = Array.from(new Set(requires));

          if (name) {
            content += `\n\n### Garden Examples: ${name}`;
            if (desc) {
              content += `\nDescription: ${desc}`;
            }
            if (uniqueRequires.length > 0) {
              content += `\nRequires: ${uniqueRequires.join(', ')}`;
            }
            const relPath = path.relative(this.projectPath, gardenFile).replace(/\\/g, '/');
            content += `\nPath: ${relPath}`;

            const gardenDir = path.dirname(gardenFile);
            const subfolders = ['scripts', 'references', 'datasets', 'tests'];
            for (const sub of subfolders) {
              const folderPath = path.join(gardenDir, sub);
              if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
                const files = fs.readdirSync(folderPath).map(f => path.basename(f)).join(', ');
                if (files) {
                  const capitalized = sub.charAt(0).toUpperCase() + sub.slice(1);
                  content += `\n${capitalized}: ${files}`;
                }
              }
            }
          }
        }
      } catch (e) {}
    }

    return content.trim() ? content.trim() : null;
  }
}

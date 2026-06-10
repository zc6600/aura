import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import picocolors from 'picocolors';
import yaml from 'yaml';
import * as GlobalConfig from '../../utils/globalConfig.js';
import * as PathResolver from '../../utils/pathResolver.js';
import * as UI from '../ui.js';

export class Skills {
  public static async list(
    projectPath?: string,
    options: { json?: boolean } = {},
  ): Promise<void> {
    let resolvedPath = '';
    try {
      resolvedPath =
        PathResolver.resolveProjectPath(projectPath || undefined) ||
        process.cwd();
    } catch {
      resolvedPath = process.cwd();
    }

    const skillsDir = path.join(resolvedPath, 'skills');
    const templateSkillsDir = path.join(GlobalConfig.repoPath(), 'skills');

    const skillPaths: Record<string, string> = {};
    const searchDirs = [templateSkillsDir, skillsDir];

    for (const baseDir of searchDirs) {
      if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory())
        continue;

      const subdirs = fs.readdirSync(baseDir);
      for (const subdir of subdirs) {
        const fullSubdir = path.join(baseDir, subdir);
        if (!fs.statSync(fullSubdir).isDirectory()) continue;

        const skillMd = path.join(fullSubdir, 'SKILL.md');
        if (fs.existsSync(skillMd)) {
          skillPaths[subdir] = skillMd;
        }
      }
    }

    const sortedNames = Object.keys(skillPaths).sort();

    if (sortedNames.length === 0) {
      if (options.json) {
        console.log('[]');
      } else {
        console.log('No skills found in workspace.');
      }
      return;
    }

    if (options.json) {
      const output = sortedNames.map((name) => {
        const p = skillPaths[name];
        const meta = Skills.parseSkillMeta(p);
        return {
          name,
          description: meta.description,
          location: p.replace(os.homedir(), '~'),
        };
      });
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    console.log(picocolors.blue('ℹ️ Available Agent Skills:'));
    console.log('-'.repeat(60));

    for (const name of sortedNames) {
      const p = skillPaths[name];
      const meta = Skills.parseSkillMeta(p);
      console.log(picocolors.green(`* ${name}`));
      if (meta.description) {
        console.log(`  Description: ${meta.description}`);
      }
      console.log(`  Location:    ${p.replace(os.homedir(), '~')}`);
      console.log('-'.repeat(60));
    }
  }

  public static async install(urlOrPath: string, name?: string): Promise<void> {
    let resolvedPath = '';
    try {
      resolvedPath =
        PathResolver.resolveProjectPath(undefined) || process.cwd();
    } catch {
      resolvedPath = process.cwd();
    }

    const isGit =
      urlOrPath.startsWith('http://') ||
      urlOrPath.startsWith('https://') ||
      urlOrPath.startsWith('git@');
    const tmpPrefix = path.join(os.tmpdir(), 'skill_install_');
    const tmpDir = fs.mkdtempSync(tmpPrefix);

    try {
      let srcDir = '';
      if (isGit) {
        console.log(`Cloning repository: ${urlOrPath}...`);
        try {
          await execa('git', ['clone', '--depth', '1', urlOrPath, tmpDir]);
          srcDir = tmpDir;
        } catch (err: any) {
          throw new UI.SkillError(`Failed to clone repository: ${err.message}`);
        }
      } else {
        srcDir = path.resolve(urlOrPath);
        if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
          throw new UI.SkillError(
            `Local path '${urlOrPath}' is not a directory.`,
          );
        }
      }

      // Find SKILL.md
      let skillMd = path.join(srcDir, 'SKILL.md');
      if (!fs.existsSync(skillMd)) {
        // Try searching subfolders recursively
        const matches = Skills.globSkillMd(srcDir);
        if (matches.length > 0) {
          skillMd = matches[0];
          srcDir = path.dirname(skillMd);
        } else {
          throw new UI.SkillError(
            'No SKILL.md file found in the source directory.',
          );
        }
      }

      // Determine skill name
      let skillName = name;
      if (!skillName || skillName.trim().length === 0) {
        const meta = Skills.parseSkillMeta(skillMd);
        if (meta.name && meta.name !== path.basename(path.dirname(skillMd))) {
          skillName = meta.name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
        } else {
          skillName = path
            .basename(srcDir)
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '');
        }
      } else {
        skillName = skillName.trim();
        if (
          skillName.includes('..') ||
          skillName.includes('/') ||
          skillName.includes('\\') ||
          !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(skillName)
        ) {
          throw new UI.SkillError(
            `Invalid skill name '${skillName}'. Only alphanumeric characters, underscores, and hyphens are allowed.`,
          );
        }
      }

      const destDir = path.join(resolvedPath, 'skills', skillName);
      if (fs.existsSync(destDir)) {
        throw new UI.SkillError(
          `Skill '${skillName}' already exists at: ${destDir}`,
        );
      }

      fs.mkdirSync(path.dirname(destDir), { recursive: true });
      Skills.copyFolderSync(srcDir, destDir);

      const innerGit = path.join(destDir, '.git');
      if (fs.existsSync(innerGit)) {
        fs.rmSync(innerGit, { recursive: true, force: true });
      }

      UI.printSuccess(
        `Skill '${skillName}' successfully installed to: ${destDir}`,
      );
    } finally {
      // Clean up tmp directory if it was created
      try {
        if (fs.existsSync(tmpDir)) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      } catch {}
    }
  }

  private static parseSkillMeta(skillMdPath: string): {
    name: string;
    description: string;
  } {
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const meta = {
      name: path.basename(path.dirname(skillMdPath)),
      description: '',
    };

    if (content.startsWith('---')) {
      const parts = content.split('---', 3);
      if (parts[1]) {
        try {
          const parsed = yaml.parse(parts[1]);
          if (parsed && typeof parsed === 'object') {
            meta.name = parsed.name || meta.name;
            meta.description = parsed.description || meta.description;
          }
        } catch {}
      }
    }

    if (!meta.description) {
      const firstH1 = content.split('\n').find((line) => line.startsWith('# '));
      meta.description = firstH1
        ? firstH1.substring(2).trim()
        : 'No description provided.';
    }

    return meta;
  }

  private static globSkillMd(dir: string): string[] {
    const results: string[] = [];
    const walk = (d: string) => {
      const files = fs.readdirSync(d);
      for (const f of files) {
        if (f === 'node_modules' || f === '.git' || f === '.aura') continue;
        const full = path.join(d, f);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (f === 'SKILL.md') {
          results.push(full);
        }
      }
    };
    walk(dir);
    return results;
  }

  private static copyFolderSync(from: string, to: string) {
    fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from).forEach((element) => {
      const fromPath = path.join(from, element);
      const toPath = path.join(to, element);
      if (fs.lstatSync(fromPath).isDirectory()) {
        Skills.copyFolderSync(fromPath, toPath);
      } else {
        fs.copyFileSync(fromPath, toPath);
      }
    });
  }
}

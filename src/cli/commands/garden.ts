import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import picocolors from 'picocolors';
import yaml from 'yaml';
import { HintProvider } from '../../core/context/providers/hintProvider.js';
import * as GlobalConfig from '../../utils/globalConfig.js';
import * as PathResolver from '../../utils/pathResolver.js';
import * as UI from '../ui.js';

interface Playbook {
  name: string;
  desc: string;
  requires: string[];
  path: string;
  type: string;
}

export class Garden {
  public static list(projectPath?: string): void {
    let resolvedPath = '';
    try {
      resolvedPath =
        PathResolver.resolveProjectPath(projectPath || undefined) ||
        process.cwd();
    } catch {
      resolvedPath = process.cwd();
    }

    const localGardenPath = resolvedPath
      ? path.join(resolvedPath, 'garden')
      : null;
    const templateGardenPath = path.join(GlobalConfig.repoPath(), 'garden');

    const playbooks: Record<string, Playbook> = {};

    const scanPlaybooks = (dir: string | null, type: string) => {
      if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
        return;

      const subdirs = fs.readdirSync(dir);
      for (const subdir of subdirs) {
        const fullSub = path.join(dir, subdir);
        if (!fs.statSync(fullSub).isDirectory()) continue;

        const gardenMd = path.join(fullSub, 'garden.md');
        if (fs.existsSync(gardenMd)) {
          try {
            const raw = fs.readFileSync(gardenMd, 'utf-8');
            const match = raw.match(
              /^\x2d\x2d\x2d\s+([\s\S]+?)\s+\x2d\x2d\x2d/,
            );
            if (match) {
              const meta = yaml.parse(match[1]) || {};
              playbooks[subdir] = playbooks[subdir] || {
                name: meta.name || subdir,
                desc: meta.description || 'No description provided',
                requires: meta.requires || [],
                path: gardenMd,
                type,
              };
            } else {
              playbooks[subdir] = playbooks[subdir] || {
                name: subdir,
                desc: 'Standard playbook',
                requires: [],
                path: gardenMd,
                type,
              };
            }
          } catch {}
        }
      }
    };

    if (localGardenPath) {
      scanPlaybooks(localGardenPath, 'local');
    }
    scanPlaybooks(templateGardenPath, 'template');

    const keys = Object.keys(playbooks);
    if (keys.length === 0) {
      console.log('No playbooks found.');
      return;
    }

    console.log(picocolors.blue('=== Available Garden Playbooks ===\n'));
    for (const key of keys) {
      const details = playbooks[key];
      const typeStr =
        details.type === 'local'
          ? ` [${picocolors.cyan('local')}]`
          : ` [${picocolors.gray('template')}]`;
      const reqStr =
        details.requires && details.requires.length > 0
          ? ` (Requires: ${details.requires.join(', ')})`
          : '';
      console.log(
        `🌱 ${picocolors.green(details.name)}${typeStr} - ${details.desc}${reqStr}`,
      );
      console.log(`   Path: ${details.path}\n`);
    }
  }

  public static status(projectPath?: string): void {
    let resolvedPath = '';
    try {
      resolvedPath =
        PathResolver.resolveProjectPath(projectPath || undefined) ||
        process.cwd();
    } catch {
      resolvedPath = process.cwd();
    }

    const root = path.resolve(resolvedPath);
    const dbPath = PathResolver.sessionDbPath(root);

    // 1. Soil Info
    const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    let totalEvents = 0;

    // 2. Seeds Info (Anchors) - DB portion
    const anchorsDir = path.join(root, 'anchors');
    let totalAnchors = 0;
    let completedAnchors = 0;
    let completedIds: string[] = [];
    const pendingAnchors: string[] = [];

    // Open DB once to read all needed data
    if (fs.existsSync(dbPath)) {
      let db: Database.Database | undefined;
      try {
        db = new Database(dbPath);

        // Check if events table exists
        const tableRow = db
          .prepare(
            "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='events'",
          )
          .get() as { count: number } | undefined;
        if (tableRow && tableRow.count > 0) {
          // Total events count
          const countRow = db
            .prepare('SELECT COUNT(*) as count FROM events')
            .get() as { count: number } | undefined;
          totalEvents = countRow ? Number(countRow.count) : 0;

          // Completed anchor IDs
          const anchorRows = db
            .prepare("SELECT payload FROM events WHERE tool = 'anchor_submit'")
            .all();
          completedIds = anchorRows
            .map((r: unknown) => {
              try {
                const row = r as { payload: string };
                const payload = JSON.parse(row.payload);
                return payload.anchor_id;
              } catch {
                return null;
              }
            })
            .filter(Boolean);
        }
      } catch (e: unknown) {
        console.warn(`Error querying database: ${(e as Error).message}`);
      } finally {
        if (db) {
          try {
            db.close();
          } catch {}
        }
      }
    }

    if (fs.existsSync(anchorsDir) && fs.statSync(anchorsDir).isDirectory()) {
      fs.readdirSync(anchorsDir).forEach((file) => {
        const full = path.join(anchorsDir, file);
        if (!fs.statSync(full).isFile()) return;
        const ext = path.extname(file).toLowerCase();
        if (!['.json', '.yaml', '.yml'].includes(ext)) return;

        totalAnchors++;
        try {
          const content = fs.readFileSync(full, 'utf-8');
          const data =
            ext === '.json' ? JSON.parse(content) : yaml.parse(content);
          const id = data.id || path.basename(file, ext);
          if (completedIds.includes(id)) {
            completedAnchors++;
          } else {
            pendingAnchors.push(id);
          }
        } catch {
          pendingAnchors.push(path.basename(file, ext));
        }
      });
    }

    // Check task.md lines
    const taskMdPath = path.join(root, 'task.md');
    let taskLinesCount = 0;
    let completedTaskLines = 0;
    if (fs.existsSync(taskMdPath)) {
      try {
        const content = fs.readFileSync(taskMdPath, 'utf-8');
        content.split('\n').forEach((line) => {
          const match = line.match(/-\s*\[([ xX/])\]/);
          if (match) {
            taskLinesCount++;
            if (['x', 'X'].includes(match[1])) {
              completedTaskLines++;
            }
          }
        });
      } catch {}
    }

    // 3. Pruning Info (Hints)
    let hintsCount = 0;
    let hintsOutput = '';
    try {
      const hintsProvider = new HintProvider(root);
      const provided = hintsProvider.provide();
      if (provided) {
        hintsOutput = provided;
        hintsCount = provided.split('\n').length;
      }
    } catch {}

    // Output formatting
    console.log(picocolors.blue('=== Aura Garden Status ==='));
    console.log(`Workspace: ${root}\n`);
    console.log(picocolors.yellow('[Soil - Persistent State]'));
    console.log(`  Database Path: ${dbPath.replace(root + path.sep, '')}`);
    console.log(`  Database Size: ${(dbSize / 1024.0).toFixed(2)} KB`);
    console.log(`  Total Events:  ${totalEvents}\n`);

    console.log(picocolors.yellow('[Seeds - Task & Anchors Progress]'));
    if (totalAnchors > 0) {
      const ratio = ((completedAnchors / totalAnchors) * 100).toFixed(1);
      console.log(
        `  Anchors Completed: ${completedAnchors} / ${totalAnchors} (${ratio}%)`,
      );
      if (pendingAnchors.length > 0) {
        console.log(`  Pending Anchors:   ${pendingAnchors.join(', ')}`);
      }
    } else {
      console.log(
        '  Anchors:           No step anchors found in anchors/ directory.',
      );
    }
    if (taskLinesCount > 0) {
      const taskRatio = ((completedTaskLines / taskLinesCount) * 100).toFixed(
        1,
      );
      console.log(
        `  task.md Todo Checklist: ${completedTaskLines} / ${taskLinesCount} tasks completed (${taskRatio}%)`,
      );
    } else {
      console.log('  task.md Checklist: No structured checklist items found.');
    }
    console.log();

    console.log(picocolors.yellow('[Pruning - Scanned Context Constraints]'));
    console.log(`  Active Hints Scanned: ${hintsCount}`);
    if (hintsCount > 0) {
      console.log('  Scanned Hints:');
      hintsOutput.split('\n').forEach((line) => {
        console.log(`    ${line}`);
      });
    }
  }

  public static init(playbookName: string, projectPath?: string): void {
    let resolvedPath = '';
    try {
      resolvedPath =
        PathResolver.resolveProjectPath(projectPath || undefined) ||
        process.cwd();
    } catch {
      resolvedPath = process.cwd();
    }

    const root = path.resolve(resolvedPath);
    const templateGardenPath = path.join(GlobalConfig.repoPath(), 'garden');
    const playbookTmplDir = path.join(templateGardenPath, playbookName);

    if (
      !fs.existsSync(playbookTmplDir) ||
      !fs.statSync(playbookTmplDir).isDirectory()
    ) {
      throw new UI.CliError(
        `Playbook '${playbookName}' not found in templates!\nRun 'aura garden list' to see available templates.`,
      );
    }

    const localGardenDir = path.join(root, 'garden');
    const localPlaybookDir = path.join(localGardenDir, playbookName);

    console.log(`Initializing playbook '${playbookName}' in workspace...`);

    // 1. Create garden/ router playbook if not present
    fs.mkdirSync(localGardenDir, { recursive: true });
    const routerTmpl = path.join(templateGardenPath, 'garden.md');
    const destRouter = path.join(localGardenDir, 'garden.md');
    if (fs.existsSync(routerTmpl) && !fs.existsSync(destRouter)) {
      fs.copyFileSync(routerTmpl, destRouter);
      console.log('  Created main router playbook: garden/garden.md');
    }

    // 2. Copy the playbook files to garden/<playbook>/
    if (fs.existsSync(localPlaybookDir)) {
      console.log(
        `  Playbook directory already exists at garden/${playbookName}. Overwriting config files...`,
      );
    }
    fs.mkdirSync(localPlaybookDir, { recursive: true });
    Garden.copyFolderSync(playbookTmplDir, localPlaybookDir);
    console.log(`  Created playbook workspace: garden/${playbookName}/`);

    // 3. Create key software directories
    ['src', 'data', 'anchors'].forEach((dir) => {
      const full = path.join(root, dir);
      if (!fs.existsSync(full)) {
        fs.mkdirSync(full, { recursive: true });
        console.log(`  Created directory: ${dir}/`);
      }
    });

    console.log(
      picocolors.green(
        `✓ Playbook '${playbookName}' successfully initialized!`,
      ),
    );
  }

  private static copyFolderSync(from: string, to: string) {
    fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from).forEach((element) => {
      const fromPath = path.join(from, element);
      const toPath = path.join(to, element);
      if (fs.lstatSync(fromPath).isDirectory()) {
        Garden.copyFolderSync(fromPath, toPath);
      } else {
        fs.copyFileSync(fromPath, toPath);
      }
    });
  }
}

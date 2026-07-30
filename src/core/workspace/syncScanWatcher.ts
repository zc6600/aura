import fs from 'node:fs';
import path from 'node:path';
import type { IWorkspaceWatcher } from '../kernel/interfaces.js';
import { isIgnoredRelativePath } from './ignoredDirs.js';

interface FileStat {
  mtime: number;
  size: number;
}

/**
 * Default IWorkspaceWatcher for Runner instances nobody handed a persistent
 * watcher to (one-shot CLI invocations): markSnapshot()/getModifiedFilesSince()
 * bracket a full recursive mtime/size scan of the project tree instead of
 * tailing filesystem events. More expensive per call than
 * WorkspaceWatcherService, but needs no background process to host it.
 */
export class SyncScanWatcher implements IWorkspaceWatcher {
  private readonly projectPath: string;
  private readonly snapshots = new Map<number, Record<string, FileStat>>();
  private nextId = 0;

  constructor(projectPath: string) {
    this.projectPath = path.resolve(projectPath);
  }

  public markSnapshot(): number {
    const id = this.nextId++;
    this.snapshots.set(id, this.scan());
    return id;
  }

  public async getModifiedFilesSince(snapshotId: number): Promise<string[]> {
    const before = this.snapshots.get(snapshotId) ?? {};
    this.snapshots.delete(snapshotId);
    const after = this.scan();

    const modified: string[] = [];
    for (const relativePath of Object.keys(after)) {
      const b = before[relativePath];
      const a = after[relativePath];
      if (!b || b.mtime !== a.mtime || b.size !== a.size) {
        modified.push(relativePath);
      }
    }
    return modified;
  }

  public close(): void {
    this.snapshots.clear();
  }

  private scan(): Record<string, FileStat> {
    const state: Record<string, FileStat> = {};
    const walk = (dir: string) => {
      let children: string[] = [];
      try {
        children = fs.readdirSync(dir);
      } catch (_e) {
        return;
      }
      for (const name of children) {
        const fullPath = path.join(dir, name);
        try {
          const relative = path
            .relative(this.projectPath, fullPath)
            .replace(/\\/g, '/');
          if (isIgnoredRelativePath(relative)) continue;

          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            walk(fullPath);
          } else if (stat.isFile()) {
            state[relative] = {
              mtime: Math.floor(stat.mtimeMs),
              size: stat.size,
            };
          }
        } catch (_e) {}
      }
    };
    walk(this.projectPath);
    return state;
  }
}

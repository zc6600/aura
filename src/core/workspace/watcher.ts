import path from 'node:path';
import { type FSWatcher, watch } from 'chokidar';
import type { IWorkspaceWatcher } from '../kernel/interfaces.js';
import { Runner } from '../kernel/runner.js';

interface FileChangeEvent {
  id: number;
  relativePath: string;
}

/**
 * Grace window before reading the change log: the underlying OS notification
 * reaches chokidar's listeners with a small, variable lag, so a
 * markSnapshot() -> execute tool -> getModifiedFilesSince() sequence can run
 * ahead of the event for a file the tool just wrote. This trades a small
 * fixed delay for not silently missing those files.
 */
const SETTLE_MS = 30;

/**
 * Persistent, in-memory file-change tracker for one project directory.
 * Meant to live for the lifetime of a long-running process (the Daemon) —
 * one instance is shared across every tool call, so Runner never has to
 * re-scan the whole tree to know what a tool just touched.
 */
export class WorkspaceWatcherService implements IWorkspaceWatcher {
  private watcher: FSWatcher | null = null;
  private changeEvents: FileChangeEvent[] = [];
  private currentEventId = 0;
  private readonly activeSnapshots = new Set<number>();
  private readonly projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = path.resolve(projectPath);
  }

  public start(): void {
    if (this.watcher) return;

    this.watcher = watch(this.projectPath, {
      ignored: (filePath: string) => this.isIgnored(filePath),
      persistent: true,
      ignoreInitial: true,
    });

    const recordChange = (filePath: string) => {
      const relative = path
        .relative(this.projectPath, filePath)
        .replace(/\\/g, '/');
      this.currentEventId++;
      this.changeEvents.push({ id: this.currentEventId, relativePath: relative });
    };

    this.watcher.on('add', recordChange);
    this.watcher.on('change', recordChange);
    this.watcher.on('unlink', recordChange);
  }

  public markSnapshot(): number {
    const id = this.currentEventId;
    this.activeSnapshots.add(id);
    return id;
  }

  public async getModifiedFilesSince(snapshotId: number): Promise<string[]> {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    const modified = new Set<string>();
    for (const evt of this.changeEvents) {
      if (evt.id > snapshotId) {
        modified.add(evt.relativePath);
      }
    }

    this.activeSnapshots.delete(snapshotId);
    this.trim();

    return Array.from(modified);
  }

  public close(): void {
    if (this.watcher) {
      this.watcher.close().catch(() => {});
      this.watcher = null;
    }
    this.changeEvents = [];
    this.activeSnapshots.clear();
  }

  /**
   * chokidar v4 dropped glob-string support for `ignored` — only a function,
   * RegExp, or exact path is accepted — so this reimplements the same
   * directory-name matching Runner's old sync scan used, rather than passing
   * '**\/node_modules/**'-style patterns that would silently match nothing.
   */
  private isIgnored(filePath: string): boolean {
    const relative = path
      .relative(this.projectPath, filePath)
      .replace(/\\/g, '/');
    if (!relative || relative.startsWith('..')) return false;
    return Runner.IGNORED_SCAN_DIRS.some(
      (d) =>
        relative === d ||
        relative.startsWith(`${d}/`) ||
        relative.includes(`/${d}/`),
    );
  }

  /** Evicts events older than the oldest snapshot still awaiting a diff. */
  private trim(): void {
    if (this.activeSnapshots.size === 0) {
      this.changeEvents.length = 0;
      return;
    }
    const minActive = Math.min(...this.activeSnapshots);
    const cutoff = this.changeEvents.findIndex((e) => e.id > minActive);
    if (cutoff === -1) {
      this.changeEvents.length = 0;
    } else if (cutoff > 0) {
      this.changeEvents.splice(0, cutoff);
    }
  }
}

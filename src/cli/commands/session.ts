import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import picocolors from 'picocolors';
import { SessionManager } from '../../core/memory/sessionManager.js';
import * as PathResolver from '../../utils/pathResolver.js';
import * as UI from '../ui.js';

export class SessionCmd {
  public static list(options: { json?: boolean } = {}): void {
    const sessionMgr = SessionCmd.resolveSessionMgr();
    const sessions = sessionMgr.list();
    const current = sessionMgr.currentName();

    if (options.json) {
      const output = sessions.map((s) => ({
        name: s.name,
        event_count: s.event_count || 0,
        last_active_at: s.last_active_at,
        is_current: s.name === current,
      }));
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    if (sessions.length === 0) {
      console.log(
        'No sessions found. Create one with: aura session create <name>',
      );
      return;
    }

    console.log('Sessions:');
    for (const s of sessions) {
      const marker = s.name === current ? ' → ' : '   ';
      const events = s.event_count || 0;
      const lastActive = s.last_active_at
        ? new Date(s.last_active_at)
            .toISOString()
            .replace('T', ' ')
            .substring(0, 16)
        : 'never';
      console.log(
        `${marker}${s.name.padEnd(30)} ${String(events).padStart(5)} events  (last: ${lastActive})`,
      );
    }
    console.log();
    console.log(`Total: ${sessions.length} session(s)`);
  }

  public static create(name: string): void {
    const sessionMgr = SessionCmd.resolveSessionMgr(true);

    if (sessionMgr.exists(name)) {
      throw new UI.SessionError(
        `Session '${name}' already exists. Use 'aura session switch ${name}' to activate it.`,
      );
    }

    const session = sessionMgr.create(name);
    UI.printSuccess(`Created session: ${name}`);
    console.log(`  Database: ${session.db_path}`);

    // Auto activate
    sessionMgr.activate(name);
    UI.printSuccess(`Activated session: ${name}`);
  }

  public static switchSession(name: string): void {
    const sessionMgr = SessionCmd.resolveSessionMgr();

    if (!sessionMgr.exists(name)) {
      const listStr = sessionMgr
        .list()
        .map((s) => `  - ${s.name}`)
        .join('\n');
      throw new UI.SessionError(
        `Session '${name}' does not exist.\nAvailable sessions:\n${listStr}`,
      );
    }

    sessionMgr.activate(name);
    UI.printSuccess(`Switched to session: ${name}`);
    console.log(`  Database: ${sessionMgr.currentDbPath()}`);
  }

  public static async deleteSession(name: string): Promise<void> {
    const sessionMgr = SessionCmd.resolveSessionMgr(true);
    const current = sessionMgr.currentName();

    if (!sessionMgr.exists(name)) {
      throw new UI.SessionError(`Session '${name}' does not exist`);
    }

    if (name === current) {
      throw new UI.SessionError(
        'Cannot delete the currently active session. Switch to another session first: aura session switch <name>',
      );
    }

    const answer = await UI.confirm(
      `Are you sure you want to delete session '${name}'?`,
    );
    if (!answer) {
      console.log('Cancelled.');
      return;
    }

    sessionMgr.delete(name);
    UI.printSuccess(`Deleted session: ${name}`);
  }

  public static duplicate(source: string, newName: string): void {
    const sessionMgr = SessionCmd.resolveSessionMgr(true);

    if (!sessionMgr.exists(source)) {
      throw new UI.SessionError(`Source session '${source}' does not exist`);
    }

    if (sessionMgr.exists(newName)) {
      throw new UI.SessionError(`Session '${newName}' already exists`);
    }

    sessionMgr.duplicate(source, newName);
    UI.printSuccess(`Duplicated '${source}' to '${newName}'`);
  }

  public static exportSession(name: string, destPath: string): void {
    const sessionMgr = SessionCmd.resolveSessionMgr();

    if (!sessionMgr.exists(name)) {
      throw new UI.SessionError(`Session '${name}' does not exist`);
    }

    sessionMgr.export(name, destPath);
    UI.printSuccess(`Exported session '${name}' to: ${destPath}`);
  }

  public static importSession(sourcePath: string, name: string): void {
    const sessionMgr = SessionCmd.resolveSessionMgr(true);

    if (!fs.existsSync(sourcePath)) {
      throw new UI.SessionError(`Source file '${sourcePath}' does not exist`);
    }

    if (sessionMgr.exists(name)) {
      throw new UI.SessionError(`Session '${name}' already exists`);
    }

    sessionMgr.import(sourcePath, name);
    UI.printSuccess(`Imported session '${name}' from: ${sourcePath}`);
  }

  public static rename(oldName: string, newName: string): void {
    const sessionMgr = SessionCmd.resolveSessionMgr(true);

    if (!sessionMgr.exists(oldName)) {
      throw new UI.SessionError(`Session '${oldName}' does not exist`);
    }

    sessionMgr.rename(oldName, newName);
    UI.printSuccess(`Renamed session: '${oldName}' → '${newName}'`);
  }

  public static current(): void {
    const sessionMgr = SessionCmd.resolveSessionMgr();
    const currentName = sessionMgr.currentName();

    if (currentName) {
      console.log(`Current session: ${currentName}`);
      console.log(`Database: ${sessionMgr.currentDbPath()}`);
    } else {
      console.log('No active session. Using default.');
    }
  }

  /**
   * Resolves a SessionManager for the current project.
   * Falls back to the global Aura config path if not in a workspace (e.g. for read-only list/current).
   * Throws SessionError for write operations that would silently affect wrong directory.
   */
  private static resolveSessionMgr(requireWorkspace = false): SessionManager {
    let resolved: string | null = null;
    let resolveError: Error | null = null;

    try {
      resolved = PathResolver.resolveProjectPath(undefined);
    } catch (e: any) {
      resolveError = e;
    }

    if (resolved) {
      return new SessionManager(resolved);
    }

    if (requireWorkspace) {
      const detail = resolveError ? `: ${resolveError.message}` : '';
      throw new UI.SessionError(
        `Not in an Aura workspace. Please navigate to a workspace directory or run 'aura new <path>' to create one.${detail}`,
      );
    }

    if (resolveError) {
      console.warn(
        picocolors.yellow(
          `⚠️ Warning: Failed to resolve workspace path: ${resolveError.message}`,
        ),
      );
    }

    // Fallback to global config path for read-only queries (list, current)
    const globalEnv = path.resolve(os.homedir(), '.aura', 'global');
    return new SessionManager(globalEnv);
  }
}

import fs from 'node:fs';
import path from 'node:path';
import picocolors from 'picocolors';
import * as PathResolver from '../../utils/pathResolver.js';
import { SessionManager } from '../../core/memory/sessionManager.js';
import * as UI from '../ui.js';

export class SessionCmd {
  public static list(options: { json?: boolean } = {}): void {
    const sessionMgr = this.resolveSessionMgr();
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
      console.log("No sessions found. Create one with: aura session create <name>");
      return;
    }

    console.log('Sessions:');
    for (const s of sessions) {
      const marker = s.name === current ? ' → ' : '   ';
      const events = s.event_count || 0;
      const lastActive = s.last_active_at
        ? new Date(s.last_active_at).toISOString().replace('T', ' ').substring(0, 16)
        : 'never';
      console.log(`${marker}${s.name.padEnd(30)} ${String(events).padStart(5)} events  (last: ${lastActive})`);
    }
    console.log();
    console.log(`Total: ${sessions.length} session(s)`);
  }

  public static create(name: string): void {
    const sessionMgr = this.resolveSessionMgr();

    if (sessionMgr.exists(name)) {
      console.error(picocolors.red(`⛔️ Error: Session '${name}' already exists`));
      console.log(`Use 'aura session switch ${name}' to activate it`);
      process.exit(1);
    }

    const session = sessionMgr.create(name);
    console.log(picocolors.green(`✓ Created session: ${name}`));
    console.log(`  Database: ${session.db_path}`);

    // Auto activate
    sessionMgr.activate(name);
    console.log(picocolors.green(`✓ Activated session: ${name}`));
  }

  public static switchSession(name: string): void {
    const sessionMgr = this.resolveSessionMgr();

    if (!sessionMgr.exists(name)) {
      console.error(picocolors.red(`⛔️ Error: Session '${name}' does not exist`));
      console.log('Available sessions:');
      sessionMgr.list().forEach((s) => console.log(`  - ${s.name}`));
      process.exit(1);
    }

    sessionMgr.activate(name);
    console.log(picocolors.green(`✓ Switched to session: ${name}`));
    console.log(`  Database: ${sessionMgr.currentDbPath()}`);
  }

  public static async deleteSession(name: string): Promise<void> {
    const sessionMgr = this.resolveSessionMgr();
    const current = sessionMgr.currentName();

    if (!sessionMgr.exists(name)) {
      console.error(picocolors.red(`⛔️ Error: Session '${name}' does not exist`));
      process.exit(1);
    }

    if (name === current) {
      console.error(picocolors.red('⛔️ Error: Cannot delete the currently active session'));
      console.log('Switch to another session first: aura session switch <name>');
      process.exit(1);
    }

    const answer = await UI.confirm(`Are you sure you want to delete session '${name}'?`);
    if (!answer) {
      console.log('Cancelled.');
      return;
    }

    sessionMgr.delete(name);
    console.log(picocolors.green(`✓ Deleted session: ${name}`));
  }

  public static duplicate(source: string, newName: string): void {
    const sessionMgr = this.resolveSessionMgr();

    if (!sessionMgr.exists(source)) {
      console.error(picocolors.red(`⛔️ Error: Source session '${source}' does not exist`));
      process.exit(1);
    }

    if (sessionMgr.exists(newName)) {
      console.error(picocolors.red(`⛔️ Error: Session '${newName}' already exists`));
      process.exit(1);
    }

    sessionMgr.duplicate(source, newName);
    console.log(picocolors.green(`✓ Duplicated '${source}' to '${newName}'`));
  }

  public static exportSession(name: string, destPath: string): void {
    const sessionMgr = this.resolveSessionMgr();

    if (!sessionMgr.exists(name)) {
      console.error(picocolors.red(`⛔️ Error: Session '${name}' does not exist`));
      process.exit(1);
    }

    sessionMgr.export(name, destPath);
    console.log(picocolors.green(`✓ Exported session '${name}' to: ${destPath}`));
  }

  public static importSession(sourcePath: string, name: string): void {
    const sessionMgr = this.resolveSessionMgr();

    if (!fs.existsSync(sourcePath)) {
      console.error(picocolors.red(`⛔️ Error: Source file '${sourcePath}' does not exist`));
      process.exit(1);
    }

    if (sessionMgr.exists(name)) {
      console.error(picocolors.red(`⛔️ Error: Session '${name}' already exists`));
      process.exit(1);
    }

    sessionMgr.import(sourcePath, name);
    console.log(picocolors.green(`✓ Imported session '${name}' from: ${sourcePath}`));
  }

  public static rename(oldName: string, newName: string): void {
    const sessionMgr = this.resolveSessionMgr();

    if (!sessionMgr.exists(oldName)) {
      console.error(picocolors.red(`⛔️ Error: Session '${oldName}' does not exist`));
      process.exit(1);
    }

    sessionMgr.rename(oldName, newName);
    console.log(picocolors.green(`✓ Renamed session: '${oldName}' → '${newName}'`));
  }

  public static current(): void {
    const sessionMgr = this.resolveSessionMgr();
    const currentName = sessionMgr.currentName();

    if (currentName) {
      console.log(`Current session: ${currentName}`);
      console.log(`Database: ${sessionMgr.currentDbPath()}`);
    } else {
      console.log('No active session. Using default.');
    }
  }

  private static resolveSessionMgr(): SessionManager {
    let resolvedPath = '';
    try {
      resolvedPath = PathResolver.resolveProjectPath(undefined) || process.cwd();
    } catch {
      resolvedPath = process.cwd();
    }
    return new SessionManager(resolvedPath);
  }
}

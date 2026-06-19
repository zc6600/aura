import path from 'node:path';
import picocolors from 'picocolors';
import {
  listAnchors,
  loadCompletedAnchorMap,
  sessionDbPath,
} from '../../daemon/handlers/anchorShared.js';
import * as PathResolver from '../../utils/pathResolver.js';

export class Anchor {
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
    const dbPath = sessionDbPath(root);
    const completedMap = loadCompletedAnchorMap(dbPath);
    const anchors = listAnchors(root, completedMap).map((anchor) => ({
      id: anchor.id,
      name: anchor.name || anchor.id,
      description: anchor.description || '',
      callWhen: anchor.call_when || [],
      next: anchor.next || [],
      status: anchor.status,
      completedAt: anchor.completedAt,
      summary: anchor.summary,
      notes: anchor.notes,
      selectedNext: anchor.selectedNext,
      runtime: anchor.runtime,
    }));

    console.log(picocolors.blue('=== Aura Anchor Status ==='));
    console.log(`Workspace: ${root}\n`);
    if (anchors.length === 0) {
      console.log('No anchors found in anchors/ directory.');
      return;
    }

    for (const anchor of anchors) {
      const statusLabel =
        anchor.status === 'completed'
          ? picocolors.green('completed')
          : picocolors.yellow('pending');
      console.log(`- ${anchor.id} [${statusLabel}]`);
      if (anchor.name && anchor.name !== anchor.id) {
        console.log(`  Name: ${anchor.name}`);
      }
      if (anchor.description) {
        console.log(`  Description: ${anchor.description}`);
      }
      if (anchor.callWhen.length > 0) {
        console.log(`  Call When: ${anchor.callWhen.join(' | ')}`);
      }
      if (anchor.next.length > 0) {
        console.log(`  Recommended Next: ${anchor.next.join(', ')}`);
      }
      if (anchor.selectedNext) {
        console.log(`  Selected Next: ${anchor.selectedNext}`);
      }
      if (anchor.completedAt) {
        console.log(`  Completed At: ${anchor.completedAt}`);
      }
      if (anchor.summary) {
        console.log(`  Summary: ${anchor.summary}`);
      }
      if (anchor.notes) {
        console.log(`  Notes: ${anchor.notes}`);
      }
      if (anchor.runtime?.phase) {
        console.log(`  Runtime Phase: ${anchor.runtime.phase}`);
      }
      if (anchor.runtime?.active_run_id) {
        console.log(`  Active Run: ${anchor.runtime.active_run_id}`);
      }
      if (anchor.runtime?.active_submission_path) {
        console.log(
          `  Submission Path: ${anchor.runtime.active_submission_path}`,
        );
      }
      if (anchor.runtime?.active_submission_id) {
        console.log(`  Submission ID: ${anchor.runtime.active_submission_id}`);
      }
      if (anchor.runtime?.resume_action) {
        console.log(`  Resume Action: ${anchor.runtime.resume_action}`);
      }
      if (anchor.runtime?.resume_at) {
        console.log(`  Resume At: ${anchor.runtime.resume_at}`);
      }
      if (anchor.runtime?.tool_note) {
        console.log(`  Tool Note: ${anchor.runtime.tool_note}`);
      }
    }
  }
}

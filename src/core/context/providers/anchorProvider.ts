import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import * as PathResolver from '../../../utils/pathResolver.js';
import { ConfigManager } from '../../../utils/configManager.js';
import Database from 'better-sqlite3';

export class AnchorProvider {
  private projectPath: string;
  private envPath: string;
  private state?: any;

  constructor(projectPath: string, options: any = {}) {
    this.projectPath = path.resolve(projectPath);
    this.envPath = options.envPath || this.projectPath;
    this.state = options.state;
  }

  public provide(): string | null {
    let planText: string | null = null;

    // 1. Try to read from state object
    if (this.state) {
      if (this.state.store && typeof this.state.store.getVariable === 'function') {
        planText = this.state.store.getVariable('plan');
      } else if (typeof this.state.getVariable === 'function') {
        planText = this.state.getVariable('plan');
      } else if (typeof this.state.getFirstValue === 'function') {
        try {
          planText = this.state.getFirstValue("SELECT value FROM variables WHERE key = 'plan' LIMIT 1");
        } catch (e) {}
      }
    }

    // 2. Try to read directly from database file if not resolved yet
    let dbPath = 'state/aura.db';
    try {
      dbPath = PathResolver.sessionDbPath(this.projectPath);
    } catch (e) {
      try {
        const config = ConfigManager.load(this.envPath) || {};
        const p = config.state_management?.db_path;
        dbPath = p ? path.resolve(this.envPath, p) : path.join(this.envPath, 'state', 'aura.db');
      } catch (err) {
        dbPath = path.join(this.envPath, 'state', 'aura.db');
      }
    }

    if (planText === null && fs.existsSync(dbPath) && fs.statSync(dbPath).isFile()) {
      let db: any;
      try {
        db = new Database(dbPath);
        const row = db.prepare("SELECT value FROM variables WHERE key = 'plan' LIMIT 1").get();
        if (row) {
          planText = String(row.value);
        }
        db.close();
      } catch (e) {
        if (db) {
          try {
            db.close();
          } catch (err) {}
        }
      }
    }

    // 3. Scan anchors/ directory
    const anchorsDir = path.join(this.projectPath, 'anchors');
    const nodes: string[] = [];
    if (fs.existsSync(anchorsDir) && fs.statSync(anchorsDir).isDirectory()) {
      try {
        const files = fs.readdirSync(anchorsDir);
        for (const file of files) {
          const filePath = path.join(anchorsDir, file);
          if (!fs.statSync(filePath).isFile()) continue;

          const ext = path.extname(file).toLowerCase();
          if (ext !== '.json' && ext !== '.yaml' && ext !== '.yml') continue;

          try {
            const rawContent = fs.readFileSync(filePath, 'utf-8');
            let data: any;
            if (ext === '.json') {
              data = JSON.parse(rawContent);
            } else {
              data = yaml.parse(rawContent);
            }

            if (data && typeof data === 'object') {
              const id = data.id || path.basename(file, ext);
              const callWhen = data.call_when;
              const brief = Array.isArray(callWhen) ? String(callWhen[0] || '') : String(callWhen || '');
              const label = brief.trim() ? `: ${brief.trim()}` : '';
              nodes.push(`- ${id}${label}`);
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    const lines: string[] = [];
    if (planText && planText.trim()) {
      lines.push(`### Overall Task\n${planText.trim()}`);
    }
    if (nodes.length > 0) {
      lines.push(`### Task Nodes\n${nodes.join('\n')}`);
    }

    return lines.length > 0 ? lines.join('\n\n') : null;
  }
}

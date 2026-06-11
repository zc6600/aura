import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import yaml from 'yaml';
import * as ConfigManager from '../../../utils/configManager.js';
import * as PathResolver from '../../../utils/pathResolver.js';

interface AnchorProviderOptions {
  envPath?: string;
  state?: unknown;
}

interface AnchorConfig {
  state_management?: {
    db_path?: string;
  };
}

export class AnchorProvider {
  private projectPath: string;
  private envPath: string;
  private state?: unknown;

  constructor(projectPath: string, options: AnchorProviderOptions = {}) {
    this.projectPath = path.resolve(projectPath);
    this.envPath = options.envPath || this.projectPath;
    this.state = options.state;
  }

  public provide(): string | null {
    let planText: string | null = null;

    // 1. Try to read from state object
    if (this.state) {
      if (
        (this.state as { store: { getVariable: (key: string) => string } })
          .store &&
        typeof (
          this.state as { store: { getVariable: (key: string) => string } }
        ).store.getVariable === 'function'
      ) {
        planText = (
          this.state as { store: { getVariable: (key: string) => string } }
        ).store.getVariable('plan');
      } else if (
        typeof (this.state as { getVariable: (key: string) => string })
          .getVariable === 'function'
      ) {
        planText = (
          this.state as { getVariable: (key: string) => string }
        ).getVariable('plan');
      } else if (
        typeof (this.state as { getFirstValue: (query: string) => string })
          .getFirstValue === 'function'
      ) {
        try {
          planText = (
            this.state as { getFirstValue: (query: string) => string }
          ).getFirstValue(
            "SELECT value FROM variables WHERE key = 'plan' LIMIT 1",
          );
        } catch (_e) {}
      }
    }

    // 2. Try to read directly from database file if not resolved yet
    let dbPath = 'state/aura.db';
    try {
      dbPath = PathResolver.sessionDbPath(this.projectPath);
    } catch (_e) {
      try {
        const config: AnchorConfig = ConfigManager.load(this.envPath) || {};
        const p = config.state_management?.db_path;
        dbPath = p
          ? path.resolve(this.envPath, p)
          : path.join(this.envPath, 'state', 'aura.db');
      } catch (_err) {
        dbPath = path.join(this.envPath, 'state', 'aura.db');
      }
    }

    if (
      planText === null &&
      fs.existsSync(dbPath) &&
      fs.statSync(dbPath).isFile()
    ) {
      let db: Database.Database | null = null;
      try {
        db = new Database(dbPath);
        const row = db
          .prepare("SELECT value FROM variables WHERE key = 'plan' LIMIT 1")
          .get() as { value: string } | undefined;
        if (row) {
          planText = String(row.value);
        }
      } catch (_e) {
        // Ignore errors reading database file if not initialized yet
      } finally {
        if (db) {
          try {
            db.close();
          } catch (_e) {}
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
            let data: Record<string, unknown>;
            if (ext === '.json') {
              data = JSON.parse(rawContent) as Record<string, unknown>;
            } else {
              data = yaml.parse(rawContent) as Record<string, unknown>;
            }

            if (data && typeof data === 'object') {
              const id = data.id || path.basename(file, ext);
              const callWhen = data.call_when;
              const brief = Array.isArray(callWhen)
                ? String(callWhen[0] || '')
                : String(callWhen || '');
              const label = brief.trim() ? `: ${brief.trim()}` : '';
              nodes.push(`- ${id}${label}`);
            }
          } catch (_e) {}
        }
      } catch (_e) {
        // Ignore errors reading anchors directory
      }
    }

    const lines: string[] = [];
    if (planText?.trim()) {
      lines.push(`### Overall Task\n${planText.trim()}`);
    }
    if (nodes.length > 0) {
      lines.push(`### Task Nodes\n${nodes.join('\n')}`);
    }

    return lines.length > 0 ? lines.join('\n\n') : null;
  }
}

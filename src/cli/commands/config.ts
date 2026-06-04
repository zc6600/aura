import fs from 'node:fs';
import path from 'node:path';
import picocolors from 'picocolors';
import yaml from 'yaml';
import * as GlobalConfig from '../../utils/globalConfig.js';
import * as PathResolver from '../../utils/pathResolver.js';

export class Config {
  public static async run(key?: string, value?: string, options: { global?: boolean } = {}): Promise<void> {
    const isGlobal = !!options.global;
    let cfgPath = '';

    if (isGlobal) {
      cfgPath = PathResolver.resolveConfigPath(GlobalConfig.repoPath());
    } else {
      const auraDir = PathResolver.findAuraDir(process.cwd());
      if (!auraDir) {
        console.error(picocolors.red('⛔️ Error: Not in an Aura workspace.'));
        console.log('To configure globally, use the --global flag.');
        console.log('To initialize a workspace in the current directory, run:');
        console.log('  $ aura new');
        process.exit(1);
      }
      cfgPath = PathResolver.resolveConfigPath(auraDir);
    }

    const cfgDir = path.dirname(cfgPath);
    if (!fs.existsSync(cfgDir)) {
      fs.mkdirSync(cfgDir, { recursive: true });
    }

    let hash: any = {};
    if (fs.existsSync(cfgPath)) {
      try {
        hash = yaml.parse(fs.readFileSync(cfgPath, 'utf-8')) || {};
      } catch {}
    }

    if (key === undefined) {
      // List all config
      console.log(yaml.stringify(hash));
    } else if (value === undefined) {
      // Read a single key
      const val = this.getHashValue(hash, key);
      if (val === undefined || val === null) {
        console.log(picocolors.yellow('(nil)'));
      } else {
        console.log(val);
      }
    } else {
      // Set key value
      this.setHashValue(hash, key, value);
      fs.writeFileSync(cfgPath, yaml.stringify(hash), 'utf-8');
      console.log(picocolors.green(`Successfully updated ${key} to ${value} in ${isGlobal ? 'global' : 'local'} config.`));
    }
  }

  private static getHashValue(hash: any, key: string): any {
    const parts = key.split('.');
    let curr = hash;
    for (const p of parts) {
      if (curr && typeof curr === 'object') {
        curr = curr[p];
      } else {
        return undefined;
      }
    }
    return curr;
  }

  private static setHashValue(hash: any, key: string, value: string): void {
    const parts = key.split('.');
    let curr = hash;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!curr[p] || typeof curr[p] !== 'object') {
        curr[p] = {};
      }
      curr = curr[p];
    }

    // Parse value type
    let parsedVal: any = value;
    if (value === 'true') {
      parsedVal = true;
    } else if (value === 'false') {
      parsedVal = false;
    } else if (/^\d+$/.test(value)) {
      parsedVal = parseInt(value, 10);
    } else if (/^\d*\.\d+$/.test(value)) {
      parsedVal = parseFloat(value);
    }

    curr[parts[parts.length - 1]] = parsedVal;
  }
}

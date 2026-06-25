import fs from 'node:fs';
import path from 'node:path';
import picocolors from 'picocolors';
import yaml from 'yaml';
import * as GlobalConfig from '../../utils/globalConfig.js';
import * as PathResolver from '../../utils/pathResolver.js';
import * as UI from '../ui.js';

export const Config = {
  async run(
    key?: string,
    value?: string,
    options: { global?: boolean } = {},
  ): Promise<void> {
    const isGlobal = !!options.global;
    let cfgPath: string | null = null;

    if (isGlobal) {
      await GlobalConfig.ensureRepo();
      cfgPath = PathResolver.resolveConfigPath(GlobalConfig.repoPath());
    } else {
      const auraDir = PathResolver.findAuraDir(process.cwd());
      if (!auraDir) {
        throw new UI.WorkspaceError(
          'Not in an Aura workspace. To configure globally, use the --global flag. To initialize a workspace in the current directory, run: aura new',
        );
      }
      cfgPath = PathResolver.resolveConfigPath(auraDir);
    }

    if (!cfgPath) {
      throw new UI.CliError('Failed to resolve configuration path.');
    }

    const cfgDir = path.dirname(cfgPath);
    if (!fs.existsSync(cfgDir)) {
      fs.mkdirSync(cfgDir, { recursive: true });
    }

    let hash: Record<string, unknown> = {};
    if (fs.existsSync(cfgPath)) {
      try {
        hash = (yaml.parse(fs.readFileSync(cfgPath, 'utf-8')) || {}) as Record<
          string,
          unknown
        >;
      } catch {}
    }

    if (key === undefined) {
      // List all config
      console.log(yaml.stringify(hash));
    } else if (value === undefined) {
      // Read a single key
      const val = Config.getHashValue(hash, key);
      if (val === undefined || val === null) {
        console.log(picocolors.yellow('(nil)'));
      } else {
        console.log(val);
      }
    } else {
      // API keys are secrets; they belong in .env, not in config.yml.
      // Use `aura env set <KEY> <VALUE> --global` instead.
      if (key === 'llm.api_key') {
        console.warn(
          picocolors.yellow(
            '⚠️ Warning: API keys are secrets and should not be saved in config.yml. Please configure them using: aura env set GEMINI_API_KEY <VALUE> --global',
          ),
        );
        return;
      }
      // Set key value
      Config.setHashValue(hash, key, value);
      fs.writeFileSync(cfgPath, yaml.stringify(hash), 'utf-8');
      console.log(
        picocolors.green(
          `Successfully updated ${key} to ${value} in ${isGlobal ? 'global' : 'local'} config.`,
        ),
      );
    }
  },

  getHashValue(hash: Record<string, unknown>, key: string): unknown {
    const parts = key.split('.');
    let curr: unknown = hash;
    for (const p of parts) {
      if (curr && typeof curr === 'object') {
        curr = (curr as Record<string, unknown>)[p];
      } else {
        return undefined;
      }
    }
    return curr;
  },

  setHashValue(
    hash: Record<string, unknown>,
    key: string,
    value: string,
  ): void {
    const parts = key.split('.');
    let curr: Record<string, unknown> = hash;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!curr[p] || typeof curr[p] !== 'object') {
        curr[p] = {};
      }
      curr = curr[p] as Record<string, unknown>;
    }

    // Parse value type
    let parsedVal: unknown = value;
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
  },
};

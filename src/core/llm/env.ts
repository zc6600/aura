import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Loads .env from a specific project directory, then falls back to global sources.
 */
export function loadFrom(projectPath: string): void {
  const localEnv = path.join(path.resolve(projectPath), '.env');
  if (fs.existsSync(localEnv)) {
    loadFile(localEnv);
  }
  loadGlobal();
}

/**
 * Loads global settings from global template repo and ~/.aura/.env.
 */
export function loadGlobal(): void {
  const globalRepoEnv = path.join(os.homedir(), '.aura', 'repo', '.env');
  if (fs.existsSync(globalRepoEnv)) {
    loadFile(globalRepoEnv);
  }

  const homeAuraEnv = path.join(os.homedir(), '.aura', '.env');
  if (fs.existsSync(homeAuraEnv)) {
    loadFile(homeAuraEnv);
  }
}

/**
 * Parses and loads an env file, applying values only if the keys are not already set.
 */
export function loadFile(filePath: string): void {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    for (let line of lines) {
      line = line.trim();
      if (line.length === 0 || line.startsWith('#')) {
        continue;
      }

      // Strip comments (handling quoted text correctly)
      let inDoubleQuote = false;
      let inSingleQuote = false;
      let commentIndex: number | null = null;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' && !inSingleQuote) {
          inDoubleQuote = !inDoubleQuote;
        } else if (char === "'" && !inDoubleQuote) {
          inSingleQuote = !inSingleQuote;
        } else if (char === '#' && !inDoubleQuote && !inSingleQuote) {
          commentIndex = i;
          break;
        }
      }

      if (commentIndex !== null) {
        line = line.slice(0, commentIndex);
      }

      line = line.trim();
      if (line.length === 0) {
        continue;
      }

      // Remove leading "export " if present
      line = line.replace(/^export\s+/, '');

      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) {
        continue;
      }

      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();

      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }

      // Last writer wins (Ruby ||= equivalent in JS: only set if undefined/empty)
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch (err) {
    // Fail silently matching Ruby's rescue StandardError
  }
}

/**
 * Resolves the API key for a provider based on environment variables.
 */
export function resolveApiKey(provider: string): string | undefined {
  const name = provider.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const vendorKey = name.length > 0 ? `${name}_API_KEY` : '';
  
  if (vendorKey && process.env[vendorKey] && process.env[vendorKey]!.trim().length > 0) {
    return process.env[vendorKey];
  }
  
  return process.env.AURA_LLM_API_KEY;
}

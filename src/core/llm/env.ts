import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { auraHome } from '../../utils/globalConfig.js';

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
 * Loads global settings from global template repo and ~/.aura-framework/.env (or legacy ~/.aura/.env).
 */
export function loadGlobal(): void {
  let globalRepoEnv = path.join(auraHome(), 'repo', '.env');
  if (!fs.existsSync(globalRepoEnv)) {
    globalRepoEnv = path.join(os.homedir(), '.aura', 'repo', '.env');
  }
  if (fs.existsSync(globalRepoEnv)) {
    loadFile(globalRepoEnv);
  }

  let homeAuraEnv = path.join(auraHome(), '.env');
  if (!fs.existsSync(homeAuraEnv)) {
    homeAuraEnv = path.join(os.homedir(), '.aura', '.env');
  }
  if (fs.existsSync(homeAuraEnv)) {
    loadFile(homeAuraEnv);
  }
}

/**
 * Parses and loads an env file, applying values only if the keys are not already set.
 */
export function loadFile(filePath: string): void {
  try {
    const content = fs.readFileSync(filePath);
    const parsed = dotenv.parse(content);
    for (const key of Object.keys(parsed)) {
      if (!process.env[key]) {
        process.env[key] = parsed[key];
      }
    }
  } catch (_err) {
    // Fail silently matching Ruby's rescue StandardError
  }
}

/**
 * Resolves the API key for a provider based on environment variables.
 */
export function resolveApiKey(provider: string): string | undefined {
  const name = provider.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const vendorKey = name.length > 0 ? `${name}_API_KEY` : '';

  if (
    vendorKey &&
    process.env[vendorKey] &&
    process.env[vendorKey]?.trim().length > 0
  ) {
    return process.env[vendorKey];
  }

  return process.env.AURA_LLM_API_KEY;
}

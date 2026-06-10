import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { type AuraConfig, parseAuraConfig } from './configSchema.js';
import * as PathResolver from './pathResolver.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class FileNotFoundError extends ConfigError {
  constructor(message: string) {
    super(message);
    this.name = 'FileNotFoundError';
  }
}

export class ParseError extends ConfigError {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

/**
 * Loads configuration from project path or environment path.
 */
export function load(
  projectPathOrEnvPath: string,
  options: { required?: boolean } = {},
): Record<string, unknown> {
  const configPath = PathResolver.resolveConfigPath(projectPathOrEnvPath);

  if (!configPath || configPath.trim().length === 0) {
    if (options.required) {
      throw new ConfigError('Config path could not be resolved');
    }
    return {};
  }

  if (!fs.existsSync(configPath)) {
    if (options.required) {
      throw new FileNotFoundError(`Config file not found: ${configPath}`);
    }
    return {};
  }

  try {
    const fileContent = fs.readFileSync(configPath, 'utf-8');
    return YAML.parse(fileContent) || {};
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (err instanceof FileNotFoundError || e.code === 'ENOENT') {
      throw new FileNotFoundError(
        `Cannot read config file: ${configPath} - ${e.message}`,
      );
    }
    throw new ParseError(`Invalid YAML in ${configPath}: ${e.message}`);
  }
}

/**
 * Loads and validates configuration using Zod schema.
 * Returns a fully typed AuraConfig with defaults applied.
 */
export function loadTyped(
  projectPathOrEnvPath: string,
  options: { required?: boolean } = {},
): AuraConfig {
  const raw = load(projectPathOrEnvPath, options);
  return parseAuraConfig(raw);
}

/**
 * Loads config with fallback path if the primary config is missing.
 */
export function loadWithFallback(
  primaryPath: string,
  fallbackPath?: string,
): Record<string, unknown> {
  try {
    return load(primaryPath, { required: true });
  } catch (err) {
    if (err instanceof FileNotFoundError && fallbackPath) {
      try {
        return load(fallbackPath, { required: true });
      } catch {
        return {};
      }
    }
    return {};
  }
}

/**
 * Gets a deeply nested value using a dot-notation key.
 */
export function get(configObj: Record<string, unknown>, key: string): unknown {
  if (!configObj || !key) return undefined;

  const parts = key.split('.');
  let current: unknown = configObj;

  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== 'object'
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Sets a deeply nested value using a dot-notation key, coercing values to appropriate types.
 */
export function set(
  configObj: Record<string, unknown>,
  key: string,
  value: string,
): void {
  if (!configObj || !key) return;

  const parts = key.split('.');
  let current: any = configObj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (
      current[part] === null ||
      current[part] === undefined ||
      typeof current[part] !== 'object'
    ) {
      current[part] = {};
    }
    current = current[part];
  }

  const lastPart = parts[parts.length - 1];

  // Coerce value type (matching Ruby's ConfigCommand type conversions)
  let parsedValue: unknown = value;
  if (value === 'true') {
    parsedValue = true;
  } else if (value === 'false') {
    parsedValue = false;
  } else if (/^\d+$/.test(value)) {
    parsedValue = parseInt(value, 10);
  } else if (/^\d*\.\d+$/.test(value)) {
    parsedValue = parseFloat(value);
  }

  current[lastPart] = parsedValue;
}

/**
 * Writes the configuration object back to configPath.
 */
export function write(
  configPath: string,
  configObj: Record<string, unknown>,
): void {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const content = YAML.stringify(configObj);
  fs.writeFileSync(configPath, content, 'utf-8');
}

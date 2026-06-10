import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceError } from '../cli/ui.js';

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

export class ArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgumentError';
  }
}

export const MAX_SESSION_NAME_LENGTH = 64;
export const SESSION_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/**
 * Validates file paths to prevent traversal attacks.
 */
export function validateSafePath(pathStr: string, baseDir: string): string {
  const expandedBase = path.resolve(baseDir);
  const realBase = fs.existsSync(expandedBase)
    ? fs.realpathSync(expandedBase)
    : expandedBase;

  const expanded = path.resolve(realBase, pathStr);

  // Find the closest existing ancestor to resolve symbolic links correctly
  let current = expanded;
  let real = expanded;
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(current)) {
      const realAncestor = fs.realpathSync(current);
      real = path.join(realAncestor, path.relative(current, expanded));
      break;
    }
    current = path.dirname(current);
  }

  const isSafe = real === realBase || real.startsWith(realBase + path.sep);
  if (!isSafe) {
    throw new SecurityError(
      `Path traversal detected: ${pathStr} escapes base directory ${baseDir}`,
    );
  }

  return real;
}

/**
 * Sanitizes and validates a session name.
 */
export function sanitizeSessionName(name?: string): string {
  if (!name || name.trim().length === 0) {
    return 'default';
  }

  const trimmed = name.trim();

  if (
    trimmed.includes('..') ||
    trimmed.includes('/') ||
    trimmed.includes('\\')
  ) {
    throw new ArgumentError('Session name cannot contain path separators');
  }

  if (trimmed.length > MAX_SESSION_NAME_LENGTH) {
    throw new ArgumentError(
      `Session name too long (max ${MAX_SESSION_NAME_LENGTH} characters)`,
    );
  }

  if (!SESSION_NAME_PATTERN.test(trimmed)) {
    throw new ArgumentError(
      'Session name must start with alphanumeric character and contain only letters, numbers, hyphens, and underscores',
    );
  }

  return trimmed;
}

/**
 * Validates web server port numbers.
 */
export function validatePort(port: string | number): number {
  const num = typeof port === 'number' ? port : parseInt(port, 10);
  if (Number.isNaN(num) || num < 0 || num > 65535) {
    throw new ArgumentError('Port must be between 0 and 65535');
  }

  if (num > 0 && num < 1024) {
    console.warn(
      `\x1b[33m⚠️  Warning: Port ${num} is a privileged port (< 1024). May require root privileges.\x1b[0m`,
    );
  }

  return num;
}

/**
 * Validates maximum steps for agent loops.
 */
export const MAX_STEPS_LIMIT = 1000;
export function validateMaxSteps(steps: string | number): number {
  const num = typeof steps === 'number' ? steps : parseInt(steps, 10);
  if (Number.isNaN(num) || num <= 0) {
    throw new ArgumentError('Max steps must be a positive number');
  }
  if (num > MAX_STEPS_LIMIT) {
    throw new ArgumentError(`Max steps exceeds limit (${MAX_STEPS_LIMIT})`);
  }

  return num;
}

/**
 * Finds the environment path for a given workspace path.
 */
export function environmentPath(projectPath?: string): string | null {
  if (process.env.AURA_GLOBAL_ENV === 'true') {
    const globalEnv = path.resolve(os.homedir(), '.aura', 'global');
    if (!fs.existsSync(globalEnv) || !fs.statSync(globalEnv).isDirectory()) {
      fs.mkdirSync(globalEnv, { recursive: true });
    }
    return globalEnv;
  }

  if (!projectPath) return null;

  const expanded = path.resolve(projectPath);
  const hiddenDir = path.join(expanded, '.aura');
  if (fs.existsSync(hiddenDir) && fs.statSync(hiddenDir).isDirectory()) {
    return hiddenDir;
  }
  return expanded;
}

/**
 * Finds the workspace root path (parent of .aura if it exists).
 */
export function workspacePath(projectPath?: string): string | null {
  if (!projectPath) return null;

  if (process.env.AURA_GLOBAL_ENV === 'true') {
    return path.resolve(projectPath);
  }

  const expanded = path.resolve(projectPath);
  if (path.basename(expanded) === '.aura') {
    return path.dirname(expanded);
  }
  return expanded;
}

/**
 * Climb parent directories to locate a valid .aura folder.
 */
export function findAuraDir(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  const globalAura = path.resolve(os.homedir(), '.aura');

  while (true) {
    const hidden = path.join(dir, '.aura');
    if (
      fs.existsSync(hidden) &&
      fs.statSync(hidden).isDirectory() &&
      hidden !== globalAura
    ) {
      return hidden;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve project path with consistent behavior across all commands.
 */
export function resolveProjectPath(projectPath?: string): string | null {
  if (process.env.AURA_GLOBAL_ENV === 'true') {
    return !projectPath || projectPath.trim().length === 0
      ? process.cwd()
      : path.resolve(projectPath);
  }

  const startDir =
    !projectPath || projectPath.trim().length === 0
      ? process.cwd()
      : path.resolve(projectPath);
  const auraDir = findAuraDir(startDir);

  if (auraDir) {
    return path.dirname(auraDir);
  }
  return null;
}

/**
 * Ensure starting from a workspace, otherwise print standard error and exit.
 */
export function ensureWorkspace(startDir: string = process.cwd()): string {
  if (process.env.AURA_GLOBAL_ENV === 'true') {
    const globalEnv = path.resolve(os.homedir(), '.aura', 'global');
    if (!fs.existsSync(globalEnv) || !fs.statSync(globalEnv).isDirectory()) {
      fs.mkdirSync(globalEnv, { recursive: true });
    }
    return globalEnv;
  }

  const auraDir = findAuraDir(startDir);
  if (!auraDir) {
    throw new WorkspaceError(
      'Not in an Aura workspace (no .aura folder found in parent directories).',
    );
  }
  return auraDir;
}

/**
 * Resolve the config.yml path inside an environment path.
 */
export function resolveConfigPath(
  projectPathOrEnvPath?: string,
): string | null {
  if (!projectPathOrEnvPath) return null;

  const envPath =
    environmentPath(projectPathOrEnvPath) || path.resolve(projectPathOrEnvPath);

  const subfolderCfg = path.join(envPath, 'config', 'config.yml');
  if (fs.existsSync(subfolderCfg)) {
    return subfolderCfg;
  } else {
    const rootCfg = path.join(envPath, 'config.yml');
    return fs.existsSync(rootCfg) ? rootCfg : subfolderCfg;
  }
}

/**
 * Resolves the database file path for a given session.
 */
export function sessionDbPath(
  projectPath?: string,
  sessionName?: string,
): string {
  const envPath =
    environmentPath(projectPath || '.') || path.resolve(projectPath || '.');
  const stateDir = path.join(envPath, 'state');

  const envDb = process.env.AURA_STATE_DB_PATH;
  if (envDb && envDb.trim().length > 0) {
    const resolvedDb = path.resolve(envPath, envDb);
    fs.mkdirSync(path.dirname(resolvedDb), { recursive: true });
    return resolvedDb;
  }

  let resolvedSession = sessionName || process.env.AURA_SESSION_NAME;
  if (!resolvedSession || resolvedSession.trim().length === 0) {
    const activeTxt = path.join(stateDir, 'active_session.txt');
    if (fs.existsSync(activeTxt)) {
      try {
        resolvedSession = fs.readFileSync(activeTxt, 'utf-8').trim();
      } catch (_err) {
        resolvedSession = 'default';
      }
    } else {
      fs.mkdirSync(stateDir, { recursive: true });
      try {
        fs.writeFileSync(activeTxt, 'default');
      } catch (_err) {
        // Ignore write failures
      }
      resolvedSession = 'default';
    }
  }

  if (!resolvedSession || resolvedSession.trim().length === 0) {
    resolvedSession = 'default';
  }

  resolvedSession = sanitizeSessionName(resolvedSession);

  // Backward compatibility migration
  const legacyDb = path.join(stateDir, 'aura.db');
  const defaultDb = path.join(stateDir, 'sessions', 'default.db');
  if (fs.existsSync(legacyDb) && !fs.existsSync(defaultDb)) {
    fs.mkdirSync(path.dirname(defaultDb), { recursive: true });
    try {
      fs.renameSync(legacyDb, defaultDb);
    } catch (err) {
      console.warn(`[PathResolver] Migration failed: ${err}`);
    }
  }

  fs.mkdirSync(path.join(stateDir, 'sessions'), { recursive: true });
  return path.join(stateDir, 'sessions', `${resolvedSession}.db`);
}

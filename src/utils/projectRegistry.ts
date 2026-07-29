import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { auraHome } from './globalConfig.js';

export function configPath(): string {
  return (
    process.env.AURA_GLOBAL_PROJECTS_CONFIG_PATH ||
    path.join(auraHome(), 'projects.yml')
  );
}

/**
 * Retrieve all registered projects as a record mapping name to absolute path
 */
export function registeredProjects(): Record<string, string> {
  const p = configPath();
  if (!fs.existsSync(p)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const data = yaml.parse(raw);
    return data && typeof data === 'object' && data.projects
      ? data.projects
      : {};
  } catch (_e) {
    return {};
  }
}

interface GlobalProjectsConfig {
  projects?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Register a workspace path with a project name globally. If `name` is
 * already registered under a *different* path (e.g. two unrelated projects
 * that happen to share a directory basename — "backend", "api", ...),
 * silently overwriting that entry would point every future lookup of that
 * name at the wrong project. Instead this disambiguates by appending
 * `-2`, `-3`, ... and returns the name actually used, so callers (and, for
 * `aura register`, the user) can see when that happened.
 */
export function register(name: string, projectPath: string): string {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });

  let data: GlobalProjectsConfig = {};
  if (fs.existsSync(p)) {
    try {
      data = (yaml.parse(fs.readFileSync(p, 'utf-8')) ||
        {}) as GlobalProjectsConfig;
    } catch (_e) {
      data = {};
    }
  }

  if (!data || typeof data !== 'object') {
    data = {};
  }
  if (!data.projects || typeof data.projects !== 'object') {
    data.projects = {};
  }

  const resolvedPath = path.resolve(projectPath);
  let finalName = name;
  if (
    data.projects[finalName] !== undefined &&
    data.projects[finalName] !== resolvedPath
  ) {
    let suffix = 2;
    while (
      data.projects[`${name}-${suffix}`] !== undefined &&
      data.projects[`${name}-${suffix}`] !== resolvedPath
    ) {
      suffix++;
    }
    finalName = `${name}-${suffix}`;
    console.warn(
      `\x1b[33m⚠️  Project name '${name}' is already registered for a different path (${data.projects[name]}). Registering this one as '${finalName}' instead.\x1b[0m`,
    );
  }

  data.projects[finalName] = resolvedPath;
  fs.writeFileSync(p, yaml.stringify(data), 'utf-8');
  return finalName;
}

/**
 * Unregister a project name globally
 */
export function unregister(name: string): boolean {
  const p = configPath();
  if (!fs.existsSync(p)) {
    return false;
  }

  let data: GlobalProjectsConfig = {};
  try {
    data = (yaml.parse(fs.readFileSync(p, 'utf-8')) ||
      {}) as GlobalProjectsConfig;
  } catch (_e) {
    return false;
  }

  if (!data || typeof data !== 'object' || !data.projects) {
    return false;
  }

  if (data.projects[name] !== undefined) {
    delete data.projects[name];
    fs.writeFileSync(p, yaml.stringify(data), 'utf-8');
    return true;
  }

  return false;
}

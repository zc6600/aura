import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';

export function configPath(): string {
  return (
    process.env.AURA_GLOBAL_PROJECTS_CONFIG_PATH ||
    path.join(os.homedir(), '.aura', 'projects.yml')
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
 * Register a workspace path with a project name globally
 */
export function register(name: string, projectPath: string): void {
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

  data.projects[name] = path.resolve(projectPath);
  fs.writeFileSync(p, yaml.stringify(data), 'utf-8');
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

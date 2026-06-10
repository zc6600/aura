import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as PathResolver from '../../../utils/pathResolver.js';
import {
  CRITIC_HEAVY_PROTOCOL_PROMPT,
  CRITIC_PROTOCOL_PROMPT,
  DEFAULT_CRITIC_AUDIT_RULES,
  DEFAULT_RALPH_USER_DIRECTIVES,
  RALPH_PROTOCOL_PROMPT,
} from './ralphPrompt.js';

interface CacheEntry {
  mtime: number;
  content: string;
}

const cache = new Map<string, CacheEntry>();

export const SECTIONS = [
  '01_mission.md',
  '02_workspace.md',
  '03_operational_rules.md',
  '04_tool_spec.md',
  '05_skill_spec.md',
  '06_constraints.md',
];

/**
 * Finds the package root dynamically by climbing up looking for package.json.
 */
function findPackageRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

const currentFileDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = findPackageRoot(currentFileDir);

/**
 * Resolves the default framework system prompt directory.
 */
export function getDefaultSystemPromptDir(): string {
  // In development (tsx)
  const devPath = path.join(
    packageRoot,
    'src',
    'core',
    'llm',
    'prompts',
    'system',
  );
  if (fs.existsSync(devPath)) return devPath;

  // In production (dist)
  const prodPath = path.join(packageRoot, 'dist', 'system');
  if (fs.existsSync(prodPath)) return prodPath;

  // Fallback relative to the registry script
  return path.join(currentFileDir, 'system');
}

/**
 * Reads a file, strips YAML front-matter, and caches content.
 */
export function readFileCached(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;

  try {
    const stats = fs.statSync(filePath);
    const mtime = stats.mtimeMs;

    const cached = cache.get(filePath);
    if (cached && cached.mtime === mtime) {
      return cached.content;
    }

    let content = fs.readFileSync(filePath, 'utf-8');
    if (content.startsWith('---')) {
      const parts = content.split('---', 3);
      content = parts[2] || content;
    }

    const cleaned = `${content.trim()}\n`;
    cache.set(filePath, { mtime, content: cleaned });
    return cleaned;
  } catch {
    return null;
  }
}

/**
 * Clears the registry prompt cache.
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Finds a file in the workspace or its parent directories (up to workspace root limit).
 */
export function findFileInWorkspace(
  projectPath: string | null,
  relativePaths: string[],
): string | null {
  if (!projectPath) return null;

  const workspaceRoot = path.resolve(projectPath);
  let limit = workspaceRoot;

  const auraDir = PathResolver.findAuraDir(workspaceRoot);
  if (auraDir) {
    limit = path.dirname(auraDir);
  } else {
    const wPath = PathResolver.workspacePath(workspaceRoot);
    if (wPath) limit = wPath;
  }

  limit = path.resolve(limit);

  let dir = workspaceRoot;
  while (true) {
    for (const relPath of relativePaths) {
      const fullPath = path.join(dir, relPath);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }

    if (dir === limit) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/**
 * Composes the modular system prompt by merging sections.
 */
export function composeModularSystemPrompt(projectPath: string): string {
  const defaultDir = getDefaultSystemPromptDir();
  const prompts: string[] = [];

  for (const section of SECTIONS) {
    const sectionOverride = findFileInWorkspace(projectPath, [
      `prompts/system/${section}`,
      `.aura/prompts/system/${section}`,
      `skills/system/${section}`,
      `.aura/skills/system/${section}`,
    ]);

    if (sectionOverride) {
      const content = readFileCached(sectionOverride);
      if (content) prompts.push(content);
    } else {
      const defaultPath = path.join(defaultDir, section);
      if (fs.existsSync(defaultPath)) {
        const content = readFileCached(defaultPath);
        if (content) prompts.push(content);
      }
    }
  }

  return prompts.join('\n\n');
}

/**
 * Resolves prompt based on execution mode.
 */
export function resolve(
  mode: string,
  projectPath: string,
  options: { criticMode?: string } = {},
): string {
  const m = mode.toLowerCase();

  if (m === 'standard') {
    const systemPath = findFileInWorkspace(projectPath, [
      'skills/system.md',
      '.aura/skills/system.md',
      'prompts/system.md',
      '.aura/prompts/system.md',
    ]);

    return systemPath
      ? readFileCached(systemPath) || ''
      : composeModularSystemPrompt(projectPath);
  }

  if (m === 'ralph_developer') {
    const base = RALPH_PROTOCOL_PROMPT;
    const ralphPath = findFileInWorkspace(projectPath, [
      'prompts/ralph/ralph_system.md',
      '.aura/prompts/ralph/ralph_system.md',
      'prompts/ralph_system.md',
      '.aura/prompts/ralph_system.md',
      'skills/ralph_system.md',
      '.aura/skills/ralph_system.md',
    ]);

    const custom = ralphPath
      ? readFileCached(ralphPath) || ''
      : DEFAULT_RALPH_USER_DIRECTIVES;
    return `${base}\n\n${custom}`;
  }

  if (m === 'ralph_critic') {
    const criticMode = (options.criticMode || 'light').toLowerCase();
    const base =
      criticMode === 'heavy'
        ? CRITIC_HEAVY_PROTOCOL_PROMPT
        : CRITIC_PROTOCOL_PROMPT;

    const criticPath = findFileInWorkspace(projectPath, [
      'prompts/ralph/critic_rules.md',
      '.aura/prompts/ralph/critic_rules.md',
      'prompts/critic_rules.md',
      '.aura/prompts/critic_rules.md',
      'skills/critic_rules.md',
      '.aura/skills/critic_rules.md',
    ]);

    const custom = criticPath
      ? readFileCached(criticPath) || ''
      : DEFAULT_CRITIC_AUDIT_RULES;
    return `${base}\n\n${custom}`;
  }

  throw new Error(`ArgumentError: Unknown mode: ${mode}`);
}

/**
 * Basic validation rules for dry-runs and sync checks.
 */
export function validatePrompt(content: string): string[] {
  const issues: string[] = [];
  if (!content || content.trim().length === 0) {
    return ['Prompt content is empty'];
  }

  if (!content.toLowerCase().includes('json')) {
    issues.push('Warning: Prompt does not mention JSON output structure.');
  }

  if (!content.includes('tool') || !content.includes('args')) {
    issues.push(
      "Warning: Prompt may lack structural tool calling rules (missing 'tool' or 'args').",
    );
  }

  if (content.includes('{{') && !content.includes('{{project_path}}')) {
    issues.push(
      'Warning: Contains unresolved template placeholders (unrecognized double curly braces).',
    );
  }

  return issues;
}

/**
 * Directory names skipped when walking a project tree — tooling noise, VCS
 * metadata, and build output that no file-change tracker or tree view should
 * ever report. Shared by every IWorkspaceWatcher implementation and by
 * WorkspaceRuntime's file-tree listing, so there is one list to keep current
 * instead of three copies drifting apart.
 */
export const IGNORED_SCAN_DIRS = [
  '.git',
  '.aura',
  '.aura-workspace',
  'node_modules',
  '.bundle',
  'vendor/bundle',
  'tmp',
  'log',
  'coverage',
  '.next',
  '.nuxt',
  'dist',
  'build',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.venv',
  'venv',
  'env',
  '.cargo',
  'target',
  '.idea',
  '.vscode',
];

/** Whether a path (already relative to the project root, `/`-separated) falls under an ignored directory. */
export function isIgnoredRelativePath(relativePath: string): boolean {
  if (!relativePath || relativePath.startsWith('..')) return false;
  return IGNORED_SCAN_DIRS.some(
    (d) =>
      relativePath === d ||
      relativePath.startsWith(`${d}/`) ||
      relativePath.includes(`/${d}/`),
  );
}

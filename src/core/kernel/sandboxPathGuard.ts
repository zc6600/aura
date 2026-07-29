import path from 'node:path';

/**
 * Heuristic, best-effort scan of a shell command string for path-like tokens
 * that resolve outside a set of allowed roots. This is NOT a real security
 * boundary — arbitrary shell can trivially hide a path from string inspection
 * (command substitution, base64, symlinks, etc). It exists to catch honest
 * agent mistakes before they run, not to contain an adversarial one; the
 * sandbox process/container boundary is what actually enforces containment.
 */

const PATH_TOKEN_RE = /^(~|\.{1,2}|\/)([^\s]*)$/;

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null = re.exec(command);
  while (m !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? '');
    m = re.exec(command);
  }
  return tokens;
}

function looksLikePath(token: string): boolean {
  if (!token) return false;
  if (PATH_TOKEN_RE.test(token)) return true;
  return token.includes('/') && !token.startsWith('-');
}

function isWithin(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Scans `command` for path-like tokens resolved against `projectPath`, and
 * returns the first one that falls outside `projectPath` and every root in
 * `allowRoots`. Returns null if the command looks fully contained.
 */
export function findOutsideSandboxPath(
  command: string,
  projectPath: string,
  allowRoots: string[] = [],
): string | null {
  if (!command || !command.trim()) return null;

  const roots = [projectPath, ...allowRoots].map((r) => path.resolve(r));
  const tokens = tokenize(command);

  for (const token of tokens) {
    if (!looksLikePath(token)) continue;

    const expanded =
      token === '~' || token.startsWith('~/')
        ? path.join(
            process.env.HOME || process.env.USERPROFILE || '',
            token.slice(1),
          )
        : token;

    const resolved = path.resolve(projectPath, expanded);
    const contained = roots.some((root) => isWithin(root, resolved));
    if (!contained) {
      return resolved;
    }
  }

  return null;
}

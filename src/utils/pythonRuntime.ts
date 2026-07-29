import fs from 'node:fs';
import path from 'node:path';

/**
 * Picks whichever of `python3`/`python` actually exists on PATH. Many
 * modern systems (macOS + Homebrew, most current Linux distros) only ship
 * `python3` — a bare `python` binary is not guaranteed to exist. Cached for
 * the process lifetime; PATH isn't expected to change mid-run.
 */
let pythonBinaryCache: string | null = null;

export function resolvePythonBinary(): string {
  if (pythonBinaryCache) {
    return pythonBinaryCache;
  }
  for (const candidate of ['python3', 'python']) {
    if (commandExistsOnPath(candidate)) {
      pythonBinaryCache = candidate;
      return candidate;
    }
  }
  // Neither found — fall back to naming the modern default so the spawn
  // failure at least reports a real, expected interpreter name.
  pythonBinaryCache = 'python3';
  return 'python3';
}

function commandExistsOnPath(cmd: string): boolean {
  const pathEnv = process.env.PATH || '';
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
      : [''];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        fs.accessSync(path.join(dir, cmd + ext), fs.constants.X_OK);
        return true;
      } catch {}
    }
  }
  return false;
}

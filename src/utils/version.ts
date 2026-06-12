import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function getPackageVersion(): string {
  try {
    const pkgPath = fileURLToPath(
      new URL('../../package.json', import.meta.url),
    );
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return pkg.version;
  } catch {
    return '0.1.0'; // Fallback
  }
}

export const VERSION = getPackageVersion();

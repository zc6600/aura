import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sandboxRoot = path.join(__dirname, '.sandbox');
const tempProjectsRoot = path.join(__dirname, 'temp-projects');

export function setup() {
  // Per-file AURA_HOME/repo/projects.yml are created by
  // setupSandboxIsolation.ts as each test file starts. Only the shared
  // socket directory (see vitest.config.ts for why it stays shared) needs
  // to exist up front.
  fs.mkdirSync(path.join(sandboxRoot, 'sockets'), { recursive: true });
}

export function teardown() {
  for (const target of [tempProjectsRoot, sandboxRoot]) {
    if (!fs.existsSync(target)) continue;
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (_e) {}
  }
}

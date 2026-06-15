import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sandboxRoot = path.join(__dirname, '.sandbox');
const sandboxHome = path.join(sandboxRoot, 'home');
const sandboxAuraHome = path.join(sandboxHome, '.aura-framework');
const tempProjectsRoot = path.join(__dirname, 'temp-projects');

export function setup() {
  for (const dir of [
    path.join(sandboxRoot, 'tmp'),
    path.join(sandboxRoot, 'sockets'),
    sandboxAuraHome,
    path.join(sandboxAuraHome, 'repo'),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function teardown() {
  for (const target of [tempProjectsRoot, sandboxRoot]) {
    if (!fs.existsSync(target)) continue;
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (_e) {}
  }
}

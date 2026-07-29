import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sandboxRoot = path.join(__dirname, '.sandbox');

/**
 * Gives each test FILE its own AURA_HOME instead of sharing one across the
 * whole run. Test files run concurrently across vitest's worker pool, and
 * several paths under test mutate global state non-atomically — a single
 * projects.yml read-modify-written across files, a single git-managed
 * template repo cloned from repeatedly. Sharing one instance raced under
 * load: corrupted git clones ("failed to copy object file"), ENOENT on
 * projects.yml mid-write, and spurious project-name collisions once
 * ProjectRegistry.register() started detecting them instead of silently
 * overwriting.
 *
 * AURA_DAEMON_SOCKET_DIR is deliberately NOT isolated here and stays on the
 * short shared path from vitest.config.ts: unix socket paths have a ~104
 * byte limit, this repo's absolute path already leaves near-zero headroom,
 * and socket filenames are content-hashed per project path anyway, so a
 * shared directory doesn't collide the way projects.yml/the repo checkout do.
 *
 * TMPDIR gets the same length treatment but for a different reason: it's
 * not us that puts a socket under there, it's tooling we spawn (tsx's own
 * `--import` loader creates an IPC pipe under TMPDIR). Nesting it inside
 * this repo's (already long, "Towards AGI" + spaces) checkout path plus a
 * per-file id blew that same ~104 byte limit (confirmed: 106 bytes, EINVAL).
 * Real system /tmp is short and already collision-safe on its own — mkdtemp
 * gives every caller a random unique subdirectory — so there's nothing to
 * isolate there beyond keeping it short.
 */
const instanceId = `${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
const instanceHome = path.join(sandboxRoot, 'runs', instanceId);
const auraHome = path.join(instanceHome, '.aura-framework');
const shortTmpRoot = fs.existsSync('/tmp')
  ? fs.realpathSync('/tmp')
  : os.tmpdir();
const instanceTmp = path.join(shortTmpRoot, `aura-vitest-${instanceId}`);

for (const dir of [instanceTmp, path.join(auraHome, 'repo')]) {
  fs.mkdirSync(dir, { recursive: true });
}

process.env.HOME = instanceHome;
process.env.USERPROFILE = instanceHome;
process.env.TMPDIR = instanceTmp;
process.env.TEMP = instanceTmp;
process.env.TMP = instanceTmp;
process.env.AURA_HOME = auraHome;
process.env.AURA_GLOBAL_REPO_PATH = path.join(auraHome, 'repo');
process.env.AURA_GLOBAL_PROJECTS_CONFIG_PATH = path.join(
  auraHome,
  'projects.yml',
);

afterAll(() => {
  for (const dir of [instanceHome, instanceTmp]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmRetry } from './rmRetry.js';

export interface TestSandbox {
  root: string;
  home: string;
  tmp: string;
  auraHome: string;
  sockets: string;
  globalRepo: string;
  projectsConfig: string;
  workspace: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
}

function shortTmpRoot(): string {
  if (process.env.AURA_TEST_SOCKET_TMP_DIR) {
    return process.env.AURA_TEST_SOCKET_TMP_DIR;
  }
  if (process.platform !== 'win32' && fs.existsSync('/tmp')) {
    return fs.realpathSync('/tmp');
  }
  return os.tmpdir();
}

export function createTestSandbox(prefix = 'test'): TestSandbox {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), `aura-${prefix}-sandbox-`),
  );
  const socketRoot = fs.mkdtempSync(
    path.join(shortTmpRoot(), `aura-${prefix}-sock-`),
  );
  const home = path.join(root, 'home');
  const tmp = path.join(root, 'tmp');
  const auraHome = path.join(home, '.aura-framework');
  const sockets = path.join(socketRoot, 'sockets');
  const globalRepo = path.join(auraHome, 'repo');
  const projectsConfig = path.join(auraHome, 'projects.yml');
  const workspace = path.join(root, 'workspace');

  for (const dir of [home, tmp, auraHome, sockets, globalRepo, workspace]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: tmp,
    TEMP: tmp,
    TMP: tmp,
    AURA_HOME: auraHome,
    AURA_GLOBAL_REPO_PATH: globalRepo,
    AURA_GLOBAL_PROJECTS_CONFIG_PATH: projectsConfig,
    AURA_DAEMON_SOCKET_DIR: sockets,
    NODE_ENV: 'test',
    NO_COLOR: '1',
  };

  return {
    root,
    home,
    tmp,
    auraHome,
    sockets,
    globalRepo,
    projectsConfig,
    workspace,
    env,
    cleanup: async () => {
      await rmRetry(root);
      await rmRetry(socketRoot);
    },
  };
}

export function withSandboxEnv<T>(sandbox: TestSandbox, callback: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(sandbox.env)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export async function withSandboxEnvAsync<T>(
  sandbox: TestSandbox,
  callback: () => Promise<T>,
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(sandbox.env)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

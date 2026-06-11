import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Resolves a unique IPC path (socket file or named pipe) based on the workspace path hash.
 * This ensures that different workspace directories use different daemon instances.
 */
export function resolveIpcPath(projectPath: string): string {
  const resolved = path.resolve(projectPath);
  const hash = crypto
    .createHash('sha256')
    .update(resolved)
    .digest('hex')
    .substring(0, 16);

  if (os.platform() === 'win32') {
    return `\\\\.\\pipe\\aura-${hash}`;
  } else {
    const socketsDir = path.join(os.homedir(), '.aura', 'sockets');
    let useFallback = false;
    if (!fs.existsSync(socketsDir)) {
      try {
        fs.mkdirSync(socketsDir, { recursive: true });
      } catch (_err: unknown) {
        useFallback = true;
      }
    } else {
      try {
        fs.accessSync(socketsDir, fs.constants.W_OK);
      } catch {
        useFallback = true;
      }
    }

    if (useFallback) {
      const username = os.userInfo().username || 'default';
      const tmpSockets = path.join(os.tmpdir(), `.aura-sockets-${username}`);
      if (!fs.existsSync(tmpSockets)) {
        try {
          fs.mkdirSync(tmpSockets, { recursive: true });
        } catch {}
      }
      return path.join(tmpSockets, `daemon-${hash}.sock`);
    }
    return path.join(socketsDir, `daemon-${hash}.sock`);
  }
}

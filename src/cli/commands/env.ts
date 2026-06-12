import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import picocolors from 'picocolors';

const GLOBAL_ENV_PATH = path.join(os.homedir(), '.aura-framework', '.env');

/**
 * Upserts a KEY=VALUE line in the target .env file.
 * Creates the file (and parent directories) if it does not exist.
 */
function upsertEnvVar(filePath: string, key: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  let content = '';
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf-8');
  }

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedKey}=.*$`, 'm');
  if (pattern.test(content)) {
    content = content.replace(pattern, `${key}=${value}`);
  } else {
    // Ensure a trailing newline before appending
    if (content.length > 0 && !content.endsWith('\n')) {
      content += '\n';
    }
    content += `${key}=${value}\n`;
  }

  fs.writeFileSync(filePath, content, 'utf-8');
}

export const Env = {
  /**
   * Sets an environment variable in ~/.aura-framework/.env (global)
   * or the workspace .env (local).
   */
  async set(
    key: string,
    value: string,
    options: { global?: boolean; workspace?: string } = {},
  ): Promise<void> {
    if (!key || value === undefined || value === null) {
      throw new Error('Usage: aura env set <KEY> <VALUE>');
    }

    let targetPath: string;

    if (options.global) {
      targetPath = GLOBAL_ENV_PATH;
    } else if (options.workspace) {
      targetPath = path.join(path.resolve(options.workspace), '.env');
    } else {
      targetPath = path.join(process.cwd(), '.env');
    }

    upsertEnvVar(targetPath, key, value);
    console.log(
      picocolors.green(
        `✓ ${key} set in ${path.relative(os.homedir(), targetPath) || targetPath}`,
      ),
    );
  },
};

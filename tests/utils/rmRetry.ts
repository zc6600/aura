import fs from 'node:fs/promises';

export async function rmRetry(targetPath: string, attempts = 5): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
}

import fs from 'node:fs';

/**
 * Reads the first 4096 bytes of a file to scan for the `@aura-hint:` magic comment.
 */
export function hasMagicHint(file: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
    const content = buffer.toString('utf-8', 0, bytesRead);
    const lines = content.split('\n').slice(0, 15);
    return lines.some((line) => line.includes('@aura-hint:'));
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

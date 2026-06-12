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

/**
 * Reads the last N lines of a file backward using a chunk buffer.
 * Avoids loading the entire file into memory, which prevents OOM on large logs.
 */
export function readLastLinesSync(
  filePath: string,
  maxLines: number,
  chunkSize = 65536,
): string {
  if (!fs.existsSync(filePath)) return '';
  const stat = fs.statSync(filePath);
  if (stat.size === 0) return '';

  const fd = fs.openSync(filePath, 'r');
  try {
    let position = stat.size;
    let newlineCount = 0;
    const newlinePositions: number[] = [];

    // Search backward for newline characters (0x0A)
    while (position > 0 && newlineCount < maxLines) {
      const bytesToRead = Math.min(position, chunkSize);
      const readAt = position - bytesToRead;
      const buffer = Buffer.alloc(bytesToRead);
      fs.readSync(fd, buffer, 0, bytesToRead, readAt);

      for (let i = bytesToRead - 1; i >= 0; i--) {
        if (buffer[i] === 0x0a) {
          // '\n'
          const absolutePos = readAt + i;
          newlinePositions.push(absolutePos);
          newlineCount++;
          if (newlineCount >= maxLines) {
            break;
          }
        }
      }
      position -= bytesToRead;
    }

    // Determine the start position for reading the last maxLines
    let startPos = 0;
    if (newlinePositions.length >= maxLines) {
      startPos = newlinePositions[maxLines - 1] + 1;
    }

    const len = stat.size - startPos;
    if (len <= 0) return '';

    const finalBuffer = Buffer.alloc(len);
    fs.readSync(fd, finalBuffer, 0, len, startPos);
    return finalBuffer.toString('utf-8');
  } finally {
    try {
      fs.closeSync(fd);
    } catch {}
  }
}

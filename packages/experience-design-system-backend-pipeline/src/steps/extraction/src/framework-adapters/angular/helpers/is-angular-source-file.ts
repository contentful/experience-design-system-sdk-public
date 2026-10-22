import { openSync, readSync, closeSync, statSync } from 'node:fs';

const HEAD_BYTES = 32 * 1024;
const buffer = Buffer.alloc(HEAD_BYTES);

export function isAngularSourceFile(filePath: string): boolean {
  if (!/\.[cm]?ts$/.test(filePath)) return false;
  if (filePath.endsWith('.d.ts')) return false;
  try {
    const stats = statSync(filePath);
    const toRead = Math.min(HEAD_BYTES, stats.size);
    if (toRead === 0) return false;
    const fd = openSync(filePath, 'r');
    try {
      const bytesRead = readSync(fd, buffer, 0, toRead, 0);
      const head = buffer.subarray(0, bytesRead).toString('utf8');
      return head.includes('@angular/core');
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

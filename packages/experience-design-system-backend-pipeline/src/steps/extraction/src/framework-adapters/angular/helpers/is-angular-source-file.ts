import { openSync, readSync, closeSync, statSync } from 'node:fs';

const HEAD_BYTES = 4 * 1024; // 4KB — more than enough for an `@angular/core` import at the top
const buffer = Buffer.alloc(HEAD_BYTES);

/**
 * Fast content-sniff: does the file head mention `@angular/core`?
 * Used by the dispatcher's sync `fileFilter`. Reads at most 4KB; false
 * negatives on files with imports past that cut-off are acceptable because
 * every Angular DS component we sampled has `@angular/core` in the first
 * ~500 bytes.
 */
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

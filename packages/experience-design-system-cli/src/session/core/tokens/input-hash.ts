import { createHash } from 'node:crypto';

export function computeTokenInputHash(rawTokenContent: string): string {
  return createHash('sha256').update(rawTokenContent.trim()).digest('hex');
}

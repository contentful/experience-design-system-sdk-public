import { createHash } from 'node:crypto';

export function hashTokenContent(rawTokenContent: string): string {
  return createHash('sha256').update(rawTokenContent.trim()).digest('hex');
}

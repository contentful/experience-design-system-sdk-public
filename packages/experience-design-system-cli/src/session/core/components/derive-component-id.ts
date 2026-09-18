import { createHash } from 'node:crypto';

export function deriveComponentId(name: string, source: string): string {
  return createHash('sha256').update(`${name}:${source}`).digest('hex').slice(0, 12);
}

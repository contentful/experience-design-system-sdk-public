import { createHash } from 'node:crypto';

export function createComponentId(name: string, resolvedSourcePath: string): string {
  const sourceHash = createHash('sha256').update(`${name}:${resolvedSourcePath}`).digest('hex').slice(0, 12);
  return `${name}-${sourceHash}`;
}

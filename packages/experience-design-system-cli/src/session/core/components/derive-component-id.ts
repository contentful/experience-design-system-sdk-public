import { createHash } from 'node:crypto';

/**
 * Derive a stable 12-char component identifier from a component's name +
 * source path. Same (name, source) → same id; used as the primary key in the
 * `raw_components` table so we can match components across CLI runs without
 * keeping a separate lookup.
 */
export function deriveComponentId(name: string, source: string): string {
  return createHash('sha256').update(`${name}:${source}`).digest('hex').slice(0, 12);
}

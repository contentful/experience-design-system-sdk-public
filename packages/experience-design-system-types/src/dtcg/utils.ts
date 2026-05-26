import type { DTCGTokenEntry } from './types.js';
import { type DesignTokenType } from './token-types.js';

export function flattenDTCG(obj: Record<string, unknown>, prefix: string): DTCGTokenEntry[] {
  const results: DTCGTokenEntry[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$')) continue;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const node = value as Record<string, unknown>;
    const path = prefix ? `${prefix}.${key}` : key;
    if ('$value' in node) {
      results.push({
        path,
        $type: node.$type as DesignTokenType,
        $value: node.$value,
        $description: node.$description as string | undefined,
      });
    } else {
      results.push(...flattenDTCG(node, path));
    }
  }
  return results;
}

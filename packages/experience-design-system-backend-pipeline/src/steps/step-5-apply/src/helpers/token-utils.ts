import type { CDFTokenEntry, DTCGTokenEntry } from '../../../shared/src/cdf-types/index.js';

export function toCdfTokens(tokens: DTCGTokenEntry[]): Array<{ path: string; entry: CDFTokenEntry }> {
  return tokens.map(({ path, ...entry }) => ({ path, entry: entry as CDFTokenEntry }));
}

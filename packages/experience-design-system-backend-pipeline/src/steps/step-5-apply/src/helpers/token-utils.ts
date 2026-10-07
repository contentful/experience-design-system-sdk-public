import type { CDFTokenEntry, DTCGTokenEntry } from '@contentful/experience-design-system-types';

export function toCdfTokens(tokens: DTCGTokenEntry[]): Array<{ path: string; entry: CDFTokenEntry }> {
  return tokens.map(({ path, ...entry }) => ({ path, entry: entry as CDFTokenEntry }));
}

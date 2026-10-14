import type { RawComponentWithId } from '../../../persistence/src/session/repositories/db.js';

export function collectDuplicateNames(components: RawComponentWithId[]): Array<{ name: string; sources: string[] }> {
  const nameCounts = new Map<string, string[]>();
  for (const c of components) {
    const sources = nameCounts.get(c.name) ?? [];
    sources.push(c.source);
    nameCounts.set(c.name, sources);
  }
  return [...nameCounts.entries()].filter(([, srcs]) => srcs.length > 1).map(([name, sources]) => ({ name, sources }));
}

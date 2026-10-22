import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ExploreScope } from '@contentful/experience-design-system-types';
import type { ExploreStageRequest } from '../../../../../steps/exploration/src/types.js';

export function createComponentExplorationCache(
  db: DatabaseSync,
  runId: string,
  options: { reuse: boolean; onHit: (scope: ExploreScope) => void },
): NonNullable<ExploreStageRequest['responseCache']> {
  const read = (key: string) =>
    db
      .prepare('SELECT origin_run_id,response_text,response_digest FROM component_exploration_cache WHERE cache_key=?')
      .get(key) as { origin_run_id: string; response_text: string; response_digest: string } | undefined;
  return {
    load(key) {
      if (!options.reuse) return undefined;
      const row = read(key);
      if (!row || createHash('sha256').update(row.response_text).digest('hex') !== row.response_digest)
        return undefined;
      return row.response_text;
    },
    save(key, output) {
      db.prepare(
        'INSERT OR REPLACE INTO component_exploration_cache (cache_key,origin_run_id,response_text,response_digest,created_at) VALUES (?,?,?,?,?)',
      ).run(key, runId, output, createHash('sha256').update(output).digest('hex'), new Date().toISOString());
    },
    hit(key, scope) {
      const row = read(key);
      if (!row) throw new Error('Component exploration cache entry unavailable');
      db.prepare(
        'INSERT OR REPLACE INTO component_exploration_cache_hits (run_id,cache_key,origin_run_id,scope,created_at) VALUES (?,?,?,?,?)',
      ).run(runId, key, row.origin_run_id, scope, new Date().toISOString());
      options.onHit(scope);
    },
  };
}

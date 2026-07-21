import { hashContent } from '../../session/cache-keys.js';

/**
 * Derive the `input_hash` for a composition-cache entry (stored in the pipeline
 * DB's `composition_cache` table). Content-addresses the candidate file set
 * (order-independent) plus the producing agent and the resolution kind, so a
 * re-run over unchanged files reuses the (token-costly) agent output.
 *
 * Content-hashing — not mtime — means a no-op `git checkout` that only bumps
 * mtime is still a hit. Prompt/skill changes are handled by the `cli_version`
 * column on the row (see `getCliCacheVersion`), so no separate resolver-version
 * constant is needed here.
 */
export function buildCompositionInputHash(input: {
  files: Array<{ path: string; content: string }>;
  agent: string;
  kind: 'parser' | 'edges';
}): string {
  const fileDigest = input.files
    .map((f) => `${f.path} ${hashContent(f.content)}`)
    .sort()
    .join('');
  return hashContent(`${input.kind}:agent:${input.agent}\n${fileDigest}`);
}

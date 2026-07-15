import type { RawComponentDefinition } from '../../types.js';
import { groupsToEdges, type CompositionEdge, type InterchangeMap } from './interchange-schema.js';
import { mergeEdges, type EdgeConflict } from './merge-edges.js';
import { parseMapEdges } from './parse-map-edges.js';
import { applyMapping } from './apply-mapping.js';
import type { CompositionAdapter } from './adapters/types.js';

export type ResolveMappingResult = {
  components: RawComponentDefinition[];
  edges: CompositionEdge[];
  conflicts: EdgeConflict[];
  warnings: string[];
};

/**
 * Orchestrate composition-map acquisition (spec T2) and enrichment (T7).
 *
 * Sources by rank: user map (1) > typed-slot (2, already on components) >
 * adapter (3) > agent (4). All present sources are unioned; conflicts resolve
 * by rank. The agent runs only when `useAgent`/`forceAgent` is set AND there
 * is residue a higher-rank source didn't cover (routing/cost optimization) —
 * `forceAgent` bypasses that suppression but never changes rank.
 *
 * `runAgentFn` is injected (returns the agent's raw stdout) so this is
 * testable without spawning a subprocess.
 */
export async function resolveMapping(input: {
  components: RawComponentDefinition[];
  userMap?: InterchangeMap;
  adapter?: CompositionAdapter;
  useAgent?: boolean;
  forceAgent?: boolean;
  files: Array<{ path: string; content: string }>;
  runAgentFn: (opts: { prompt: string; files: Array<{ path: string; content: string }> }) => Promise<string>;
  buildPrompt?: (files: Array<{ path: string; content: string }>, componentNames: string[]) => string;
}): Promise<ResolveMappingResult> {
  const componentNames = new Set(input.components.map((c) => c.name));
  const collected: CompositionEdge[] = [];
  const agentWarnings: string[] = [];

  // Rank 1 — user-provided map.
  if (input.userMap) {
    collected.push(...groupsToEdges(input.userMap, 'user'));
  }

  // Rank 3 — native adapter (deterministic).
  if (input.adapter) {
    collected.push(...input.adapter({ files: input.files, componentNames }));
  }

  // Routing: which parents are already covered by a higher-rank source?
  const coveredParents = new Set(collected.map((e) => e.parent));
  const residueParents = input.components.map((c) => c.name).filter((n) => !coveredParents.has(n));

  // Rank 4 — agent. Runs when enabled AND (forced OR there is residue).
  const shouldRunAgent = (input.useAgent || input.forceAgent) && (input.forceAgent || residueParents.length > 0);
  if (shouldRunAgent) {
    const prompt = input.buildPrompt
      ? input.buildPrompt(input.files, [...componentNames])
      : defaultPrompt(input.files, [...componentNames]);
    const raw = await input.runAgentFn({ prompt, files: input.files });
    const parsed = parseMapEdges(raw, { componentNames });
    collected.push(...parsed.edges);
    agentWarnings.push(...parsed.warnings);
  }

  const merged = mergeEdges(collected);
  const applied = applyMapping(input.components, merged.edges);

  return {
    components: applied.components,
    edges: merged.edges,
    conflicts: merged.conflicts,
    warnings: [...agentWarnings, ...applied.warnings],
  };
}

function defaultPrompt(files: Array<{ path: string; content: string }>, componentNames: string[]): string {
  const fileBlocks = files.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n');
  return [
    'You are resolving parent→child component composition from a design system.',
    'Emit one JSON object per line, each: {"tool":"map_edge","parent":"<Name>","child":"<Name>","slot"?:"<slot>","confidence"?:1-5,"reason"?:"..."}.',
    'Only use these component names:',
    componentNames.join(', '),
    '',
    'Candidate files:',
    fileBlocks,
  ].join('\n');
}

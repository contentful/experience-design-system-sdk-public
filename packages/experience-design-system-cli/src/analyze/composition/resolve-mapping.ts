import type { RawComponentDefinition } from '../../types.js';
import { groupsToEdges, type CompositionEdge, type InterchangeMap } from './interchange-schema.js';
import { mergeEdges, type EdgeConflict } from './merge-edges.js';
import { parseMapEdges } from './parse-map-edges.js';
import { applyMapping } from './apply-mapping.js';

export type ResolveMappingResult = {
  components: RawComponentDefinition[];
  edges: CompositionEdge[];
  conflicts: EdgeConflict[];
  warnings: string[];
};

/**
 * Orchestrate composition-map acquisition (spec T2) and enrichment (T7).
 *
 * Sources by rank: user map (1) > typed-slot / "code slots" (2) > agent (4).
 * ALL sources — including the code slots already on the incoming components —
 * are fed into one ranked merge and unioned; non-conflicting edges from every
 * source survive, and on a conflict (same parent+child, different slot) the
 * higher-rank source wins and the loser is recorded. The agent runs only when
 * `useAgent`/`forceAgent` is set AND there is residue a higher-rank source
 * didn't cover (routing/cost optimization) — `forceAgent` bypasses that
 * suppression but never changes rank.
 *
 * `runAgentFn` is injected (returns the agent's raw stdout) so this is
 * testable without spawning a subprocess.
 */
export async function resolveMapping(input: {
  components: RawComponentDefinition[];
  userMap?: InterchangeMap;
  useAgent?: boolean;
  forceAgent?: boolean;
  files: Array<{ path: string; content: string }>;
  runAgentFn: (opts: { prompt: string; files: Array<{ path: string; content: string }> }) => Promise<string>;
  buildPrompt?: (files: Array<{ path: string; content: string }>, componentNames: string[]) => string;
  /**
   * Custom instruction preamble (from `--prompt composition=...`). Replaces the
   * default guidance line ONLY; the machine-readable output contract + the
   * component-name allowlist + candidate files are always appended so the
   * JSONL parser keeps working regardless of the override.
   */
  promptOverride?: string;
  /**
   * Pre-resolved edges from an external source (e.g. the agent-authored parser
   * path). They join the ranked merge at their own provenance rank alongside
   * code slots and the user map. Callers using this typically set
   * `useAgent: false` since they've already run their own resolution.
   */
  extraEdges?: CompositionEdge[];
}): Promise<ResolveMappingResult> {
  const componentNames = new Set(input.components.map((c) => c.name));
  const collected: CompositionEdge[] = [];
  const agentWarnings: string[] = [];

  // Rank 2 — typed-slot ("code slots") already resolved by the AST extractor.
  // Feed them into the ranked merge so a conflicting lower-rank edge (agent
  // placing the same child in a different slot) LOSES to code rather than being
  // unioned in alongside it.
  for (const c of input.components) {
    for (const slot of c.slots) {
      for (const child of slot.allowedComponents ?? []) {
        collected.push({ parent: c.name, child, slot: slot.name, provenance: 'typed-slot' });
      }
    }
  }

  // Rank 1 — user-provided map.
  if (input.userMap) {
    collected.push(...groupsToEdges(input.userMap, 'user'));
  }

  // Externally pre-resolved edges (e.g. agent-authored parser, rank 3).
  if (input.extraEdges) {
    collected.push(...input.extraEdges);
  }

  // Routing: which parents are already covered by a higher-rank source?
  const coveredParents = new Set(collected.map((e) => e.parent));
  const residueParents = input.components.map((c) => c.name).filter((n) => !coveredParents.has(n));

  // Rank 4 — agent. Runs when enabled AND (forced OR there is residue).
  const shouldRunAgent = (input.useAgent || input.forceAgent) && (input.forceAgent || residueParents.length > 0);
  if (shouldRunAgent) {
    const prompt = input.buildPrompt
      ? input.buildPrompt(input.files, [...componentNames])
      : defaultPrompt(input.files, [...componentNames], input.promptOverride);
    const raw = await input.runAgentFn({ prompt, files: input.files });
    const parsed = parseMapEdges(raw, { componentNames });
    collected.push(...parsed.edges);
    agentWarnings.push(...parsed.warnings);
  }

  const merged = mergeEdges(collected);

  // Apply the merged edges onto components whose allowedComponents are cleared,
  // so the ranked merge is authoritative — a code edge that lost to a rank-1
  // user override is actually gone, not left behind on the original slot.
  // Slot structure is preserved; only the composition constraint is reset.
  const base: RawComponentDefinition[] = input.components.map((c) => ({
    ...c,
    slots: c.slots.map((s) => {
      const { allowedComponents: _drop, ...rest } = s;
      return rest;
    }),
  }));
  const applied = applyMapping(base, merged.edges);

  return {
    components: applied.components,
    edges: merged.edges,
    conflicts: merged.conflicts,
    warnings: [...agentWarnings, ...applied.warnings],
  };
}

const DEFAULT_COMPOSITION_INSTRUCTION = [
  'You are extracting parent→child component composition from a design system by reading the files below.',
  '',
  'STRICT RULES — follow exactly, they keep the output deterministic:',
  '1. Emit an edge ONLY when the candidate files contain explicit evidence that the parent renders/accepts the child (e.g. a mapping declaration, a slot/`allowedComponents` list, a `withParentType`/`requiredParent`/`allowedTagNames` entry). Direct textual evidence only.',
  '2. Do NOT infer, guess, or generalize from naming, category, or what "usually" nests. If the files do not state the relationship, do not emit it.',
  '3. Every edge MUST include a `reason` that quotes or cites the exact file + declaration that justifies it. If you cannot cite evidence, omit the edge.',
  '4. Emit each parent→child pair at most once. Do not repeat edges.',
  '5. Prefer completeness of EVIDENCED edges over quantity — a smaller, fully-justified set is correct; padding with plausible-but-unstated edges is wrong.',
] as const;

function defaultPrompt(
  files: Array<{ path: string; content: string }>,
  componentNames: string[],
  promptOverride?: string,
): string {
  const fileBlocks = files.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n');
  // The override replaces only the leading instruction; the output contract,
  // name allowlist, and candidate files are always appended so the JSONL
  // parser keeps working.
  const instruction = promptOverride?.trim() ? promptOverride.trim() : DEFAULT_COMPOSITION_INSTRUCTION.join('\n');
  return [
    instruction,
    '',
    'Emit one JSON object per line, each: {"tool":"map_edge","parent":"<Name>","child":"<Name>","slot"?:"<slot>","confidence"?:1-5,"reason":"<cite the file + declaration>"}.',
    'Use ONLY these exact component names (an edge naming anything else is dropped):',
    componentNames.join(', '),
    '',
    'Candidate files:',
    fileBlocks,
  ].join('\n');
}

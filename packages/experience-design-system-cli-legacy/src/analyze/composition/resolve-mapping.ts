import type { RawComponentDefinition } from '../../types.js';
import type { CompositionEdge } from './interchange-schema.js';
import { mergeEdges, type EdgeConflict } from './merge-edges.js';
import { applyMapping } from './apply-mapping.js';
import { getDebugLogger } from '../../lib/debug-logger.js';
import type { SourceCallSiteEvidence, SourceCallSiteRejection } from './source-call-site-evidence.js';

export type ResolveMappingResult = {
  components: RawComponentDefinition[];
  edges: CompositionEdge[];
  conflicts: EdgeConflict[];
  warnings: string[];
  sourceCallSiteEvidence: SourceCallSiteEvidence[];
  sourceCallSiteRejections: SourceCallSiteRejection[];
};

/**
 * Orchestrate composition-edge acquisition and enrichment.
 *
 * Sources by rank: typed-slot / "code slots" (1) > structural usage evidence
 * (2) > cited source call sites (3) > manifest (4) > doc (5) > adapter-resolved
 * / extraEdges (6). Manifest/doc edges are computed deterministically outside
 * this function (see manifest-doc-evidence.ts) and joined via `extraEdges`.
 * ALL sources — including the code slots already on the incoming components —
 * are fed into one ranked merge and unioned; non-conflicting edges from every
 * source survive, and on a conflict (same parent+child, different slot) the
 * higher-rank source wins and the loser is recorded. No agent contributes
 * edges: every edge is backed by code, a manifest or documentation.
 */
export function resolveMapping(input: {
  components: RawComponentDefinition[];
  /**
   * Pre-resolved edges from an external source (e.g. manifest or documentation)
   * path). They join the ranked merge at their own provenance rank alongside
   * code slots and other automatic mapping sources.
   */
  extraEdges?: CompositionEdge[];
  sourceCallSiteEvidence?: SourceCallSiteEvidence[];
  sourceCallSiteRejections?: SourceCallSiteRejection[];
}): ResolveMappingResult {
  const collected: CompositionEdge[] = [];

  // Rank 1 — typed-slot ("code slots") already resolved by the AST extractor.
  // Feed them into the ranked merge so a conflicting lower-rank edge (the same
  // child in a different slot) LOSES to code rather than being unioned in
  // alongside it.
  for (const c of input.components) {
    for (const slot of c.slots) {
      for (const child of slot.allowedComponents ?? []) {
        collected.push({ parent: c.name, child, slot: slot.name, provenance: 'typed-slot' });
      }
    }
  }

  // Rank 2 — structural usage evidence (runtime type-predicate, `.type ===`
  // identity check, or direct JSX nesting — see structural-slot-evidence.ts).
  // Lower trust than a declared slot contract, but still code-derived.
  for (const c of input.components) {
    for (const slot of c.slots) {
      for (const child of slot.structuralAllowedComponents ?? []) {
        collected.push({ parent: c.name, child, slot: slot.name, provenance: 'structural' });
      }
    }
  }

  // Externally pre-resolved edges — manifest (4), doc (5), adapter-authored
  // evidence (6) — each edge carries its own provenance, so this loop is rank-
  // agnostic; the merge below sorts it out.
  if (input.extraEdges) {
    collected.push(...input.extraEdges);
  }

  // Rank 3 — cited source call sites: a parent that renders a child as JSX,
  // with the path and line range of the call.
  for (const evidence of input.sourceCallSiteEvidence ?? []) {
    collected.push({
      parent: evidence.parent,
      child: evidence.child,
      ...(evidence.slot ? { slot: evidence.slot } : {}),
      citation: { sourcePath: evidence.sourcePath, startLine: evidence.startLine, endLine: evidence.endLine },
      provenance: 'call-site',
    });
  }

  const coveredParents = new Set(collected.map((e) => e.parent));
  const residueParents = input.components.map((c) => c.name).filter((n) => !coveredParents.has(n));

  const debug = getDebugLogger();
  const countByProvenance = (edges: readonly CompositionEdge[]): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const edge of edges) counts[edge.provenance] = (counts[edge.provenance] ?? 0) + 1;
    return counts;
  };
  debug.event('analyze', 'composition.pre-merge', {
    edgeCountsByProvenance: countByProvenance(collected),
    coveredParents: [...coveredParents].sort(),
    residueParents,
    sourceCallSiteAccepted: input.sourceCallSiteEvidence?.length ?? 0,
    sourceCallSiteRejected: input.sourceCallSiteRejections?.length ?? 0,
  });

  const merged = mergeEdges(collected);
  debug.event('analyze', 'composition.merged', {
    edgeCountsByProvenance: countByProvenance(merged.edges),
    conflicts: merged.conflicts,
    edges: merged.edges.map((edge) => ({
      parent: edge.parent,
      child: edge.child,
      slot: edge.slot ?? null,
      provenance: edge.provenance,
    })),
  });

  // Apply the merged edges onto components whose allowedComponents are cleared,
  // so the ranked merge is authoritative.
  // Slot structure is preserved; only the composition constraint is reset.
  const base: RawComponentDefinition[] = input.components.map((c) => ({
    ...c,
    slots: c.slots.map((s) => {
      const { allowedComponents: _drop, ...rest } = s;
      return rest;
    }),
  }));
  const applied = applyMapping(base, merged.edges);
  debug.event('analyze', 'composition.applied', {
    slots: applied.components.flatMap((component) =>
      component.slots
        .filter((slot) => (slot.allowedComponents?.length ?? 0) > 0)
        .map((slot) => ({ component: component.name, slot: slot.name, allowedComponents: slot.allowedComponents })),
    ),
    warnings: applied.warnings,
  });

  return {
    components: applied.components,
    edges: merged.edges,
    conflicts: merged.conflicts,
    warnings: applied.warnings,
    sourceCallSiteEvidence: [...(input.sourceCallSiteEvidence ?? [])],
    sourceCallSiteRejections: [...(input.sourceCallSiteRejections ?? [])],
  };
}

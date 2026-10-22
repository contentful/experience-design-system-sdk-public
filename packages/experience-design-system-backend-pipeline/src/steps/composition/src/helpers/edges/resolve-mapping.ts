import type { RawComponentDefinition } from '../../../../extraction/src/types/component.js';
import type { CompositionEdge } from './interchange-schema.js';
import { mergeEdges, type EdgeConflict } from './merge-edges.js';
import { applyCompositionEdges } from './apply-mapping.js';
import type { SourceCallSiteEvidence, SourceCallSiteRejection } from './source-call-site-evidence.js';
import type { SharedSourceCallerCoverage } from '@contentful/experience-design-system-types';

export type ResolveMappingResult = {
  components: RawComponentDefinition[];
  edges: CompositionEdge[];
  conflicts: EdgeConflict[];
  warnings: string[];
  sourceCallSiteEvidence: SourceCallSiteEvidence[];
  sourceCallSiteRejections: SourceCallSiteRejection[];
  sourceCallSiteCoverage?: SharedSourceCallerCoverage;
};

export async function resolveMapping(input: {
  components: RawComponentDefinition[];
  extraEdges?: CompositionEdge[];
  sourceCallSiteEvidence?: SourceCallSiteEvidence[];
  sourceCallSiteRejections?: SourceCallSiteRejection[];
  sourceCallSiteCoverage?: SharedSourceCallerCoverage;
}): Promise<ResolveMappingResult> {
  const collected: CompositionEdge[] = [];

  for (const c of input.components) {
    for (const slot of c.slots) {
      for (const child of slot.allowedComponents ?? []) {
        collected.push({ parent: c.name, child, slot: slot.name, provenance: 'typed-slot' });
      }
    }
  }

  for (const c of input.components) {
    for (const slot of c.slots) {
      for (const child of slot.structuralAllowedComponents ?? []) {
        collected.push({ parent: c.name, child, slot: slot.name, provenance: 'structural' });
      }
    }
  }

  if (input.extraEdges) collected.push(...input.extraEdges);

  const merged = mergeEdges(collected);

  const base: RawComponentDefinition[] = input.components.map((c) => ({
    ...c,
    slots: c.slots.map((s) => {
      const { allowedComponents: _drop, ...rest } = s;
      return rest;
    }),
  }));
  const applied = applyCompositionEdges(base, merged.edges);

  return {
    components: applied.components,
    edges: merged.edges,
    conflicts: merged.conflicts,
    warnings: applied.warnings,
    sourceCallSiteEvidence: [...(input.sourceCallSiteEvidence ?? [])],
    sourceCallSiteRejections: [...(input.sourceCallSiteRejections ?? [])],
    ...(input.sourceCallSiteCoverage ? { sourceCallSiteCoverage: input.sourceCallSiteCoverage } : {}),
  };
}

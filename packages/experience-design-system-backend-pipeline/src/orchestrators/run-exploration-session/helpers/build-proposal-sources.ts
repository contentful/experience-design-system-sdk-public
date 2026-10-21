import type { RawComponentDefinition } from '../../../steps/extraction/src/types/component.js';
import type { ExploreRepresentationProposalSource } from '../../../steps/exploration/src/types.js';
import { sourcePropertyModel } from '../../../steps/generation/src/services/property/source-property-model.js';

/** Reuse generation's source identity derivation without proposing a target or assigning readiness. */
export function buildProposalSources(
  components: readonly (RawComponentDefinition & { component_id: string })[],
): ExploreRepresentationProposalSource[] {
  return components.map((component) => ({
    component: component.name,
    source: component.source,
    properties: (component.sourceCandidates ?? []).flatMap((candidate) => {
      if (!candidate.facts?.sourceGraph) return [];
      const model = sourcePropertyModel(component, candidate.name, component.component_id);
      return model ? [model] : [];
    }),
  }));
}

import type { RepresentationValidationEvidence } from './validate-representation-draft.js';
import { sourcePropertyModel } from './source-property-model.js';
import { prepareAnalysisRepresentationCandidates } from '@contentful/experience-design-system-types';

/** Supply exact proposal identities without repeating the compiler graph already in source context. */
export function buildRepresentationContext(evidence: RepresentationValidationEvidence): unknown[] {
  return evidence.inventory.properties.flatMap((prop) => {
    const model = sourcePropertyModel(evidence.component, prop, evidence.componentId);
    const prepared = model ? prepareAnalysisRepresentationCandidates(model) : undefined;
    const candidates = prepared ? (({ logicalGraph: _graph, ...summary }) => summary)(prepared) : undefined;
    return model
      ? [
          {
            ...model.identity,
            name: prop,
            analysisRepresentationCandidates: candidates,
            sourceNodeIds: model.source.graph.nodes.map((node) => node.id),
            sourceUseEvidence: model.source.useEvidence ?? [],
          },
        ]
      : [];
  });
}

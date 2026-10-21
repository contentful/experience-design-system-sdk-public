import type { RepresentationValidationEvidence } from './validate-representation-draft.js';
import { materializeProperty } from './materialize-property.js';

/** Supply exact proposal identities without repeating the compiler graph already in source context. */
export function buildRepresentationContext(evidence: RepresentationValidationEvidence): unknown[] {
  return evidence.inventory.properties.flatMap((prop) => {
    const retained = materializeProperty(
      evidence.component,
      {
        tool: 'classify_prop',
        prop,
        cdf_category: 'content',
        reason: 'Source identity context',
      },
      evidence.componentId,
    );
    const model = retained.model;
    return model
      ? [
          {
            ...model.identity,
            name: prop,
            sourceNodeIds: model.source.graph.nodes.map((node) => node.id),
            sourceUseEvidence: model.source.useEvidence ?? [],
          },
        ]
      : [];
  });
}

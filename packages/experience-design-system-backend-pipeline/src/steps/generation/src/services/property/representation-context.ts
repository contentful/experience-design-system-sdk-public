import type { RepresentationValidationEvidence } from './validate-representation-draft.js';
import { sourcePropertyModel } from './source-property-model.js';
import {
  prepareAnalysisRepresentationCandidates,
  nativeSourceRegion,
} from '@contentful/experience-design-system-types';
import { definitionCall } from './definition-call.js';

/** Supply exact proposal identities without repeating the compiler graph already in source context. */
export function buildRepresentationContext(evidence: RepresentationValidationEvidence): unknown[] {
  return evidence.inventory.properties.flatMap((prop) => {
    const model = sourcePropertyModel(evidence.component, prop, evidence.componentId);
    const prepared = model ? prepareAnalysisRepresentationCandidates(model) : undefined;
    const candidates = prepared ? (({ logicalGraph: _graph, ...summary }) => summary)(prepared) : undefined;
    const native = prepared?.logicalGraph
      ? nativeSourceRegion(
          prepared.logicalGraph.rootId,
          new Map(prepared.logicalGraph.nodes.map((node) => [node.id, node])),
        )
      : undefined;
    const identity = model
      ? { source_revision: model.identity.sourceRevision, source_node_id: model.identity.nodeId }
      : {};
    const decisionSkeletons = [
      ...(native ? [{ ...definitionCall(prop, { ...native, $category: 'content' }), ...identity }] : []),
      ...(prepared?.candidates
        .filter((candidate) => candidate.strategy === 'component-model')
        .map((candidate) => ({
          tool: 'classify_prop',
          prop,
          cdf_category: 'content',
          representation_selection: { strategy: 'component-model', candidateId: candidate.id },
          ...identity,
        })) ?? []),
    ];
    return model
      ? [
          {
            ...model.identity,
            name: prop,
            analysisRepresentationCandidates: candidates,
            sourceNodeIds: model.source.graph.nodes.map((node) => node.id),
            sourceUseEvidence: model.source.useEvidence ?? [],
            decisionSkeletons,
            skeletonInstructions:
              'These are unselected structural drafts, not authorability or category decisions. Choose the source-supported category, description and reason. Copy exact structural metadata and identities; add evidence-backed null handling when required. Validate the complete resulting call before emitting it. Missing skeletons never justify exclusion or an invented type.',
          },
        ]
      : [];
  });
}

import { contentDigest } from './content-digest.js';
import { cloneJson, freezeJson, type JsonValue } from './json-value.js';
import { prepareLogicalSourceGraph, type LogicalSourceGraph } from './logical-source-graph.js';
import { nativeSourceRegion } from './native-source-region.js';
import { LOCAL_NATIVE_PROPERTY_PROFILE, type PropertyModel } from './property-model.js';

export interface AnalysisRepresentationCandidates {
  identity: PropertyModel['identity'];
  profileDigest: string;
  candidateSetHash: string;
  status: 'prepared' | 'invalid';
  selectedCandidateId: null;
  logicalGraph?: LogicalSourceGraph;
  candidates: Array<{
    id: string;
    strategy: 'native' | 'component-model';
    requires: 'category-and-representation-decision';
  }>;
  diagnostics: string[];
}

/** Strategies are source-derived alternatives, without a selected category or target readiness. */
export function prepareAnalysisRepresentationCandidates(
  model: Pick<PropertyModel, 'identity' | 'source'>,
  profile: JsonValue = LOCAL_NATIVE_PROPERTY_PROFILE as unknown as JsonValue,
): AnalysisRepresentationCandidates {
  const common = {
    identity: cloneJson(model.identity),
    profileDigest: contentDigest(profile),
    selectedCandidateId: null,
  };
  let result: Omit<AnalysisRepresentationCandidates, 'candidateSetHash'>;
  try {
    const logicalGraph = prepareLogicalSourceGraph(model);
    const nodes = new Map(logicalGraph.nodes.map((node) => [node.id, node]));
    const strategies: Array<'native' | 'component-model'> = [];
    if (nativeSourceRegion(logicalGraph.rootId, nodes)) strategies.push('native');
    if (logicalGraph.nodes.some((node) => ['record', 'array', 'tuple', 'intersection'].includes(node.kind)))
      strategies.push('component-model');
    result = {
      ...common,
      status: 'prepared',
      logicalGraph,
      candidates: strategies.map((strategy) => ({
        id: contentDigest({ ...common, source: model.source, strategy }),
        strategy,
        requires: 'category-and-representation-decision',
      })),
      diagnostics:
        logicalGraph.coverage === 'complete-within-declared-bound'
          ? []
          : ['Source coverage remains bounded or incomplete'],
    };
  } catch (error) {
    result = {
      ...common,
      status: 'invalid',
      candidates: [],
      diagnostics: [error instanceof Error ? error.message : 'Source graph unavailable'],
    };
  }
  return freezeJson(cloneJson({ ...result, candidateSetHash: contentDigest(result) }));
}

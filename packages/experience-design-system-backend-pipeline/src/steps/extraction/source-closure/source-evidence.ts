import type { SourceFactLocation, CompilerCoverage } from '../src/candidates/types.js';
import type {
  ComponentSourceObservation,
  ComponentSourceObservationCollection,
} from '../src/types/component-source-observations.js';
import type { ClosureEdge, ClosureEnd, ClosureFact, ClosureProofStrength, ClosureScc } from './index.js';
export const SOURCE_CLOSURE_SCHEMA_VERSION = 1;
export interface SourceClosureEnd extends ClosureEnd {
  observationId?: string;
}
export interface SourceClosureNode {
  id: string;
  location: SourceFactLocation;
  observationIds: string[];
  edges: ClosureEdge[];
  ends: SourceClosureEnd[];
}
export interface SourceClosureFact {
  observationId: string;
  ownerId: string;
  kind: ComponentSourceObservation['kind'];
  strength: ClosureProofStrength;
  dependsOnOpenEnd: boolean;
  provenance: string[];
}
export interface SourceClosureCaptureBinding {
  captureId: string;
  captureDigest: string;
  envelopeId: string;
  envelopeDigest: string;
  sessionId: string;
  extractionStepId: number;
}
/** Advisory lexical reachability, independent of runtime execution and authoring decisions. */
export interface SourceClosureEvidence {
  schemaVersion: typeof SOURCE_CLOSURE_SCHEMA_VERSION;
  semantics: 'lexical-source';
  captureBinding: SourceClosureCaptureBinding | null;
  rootId: string;
  status: 'available' | 'partial' | 'unavailable' | 'failed';
  reason: string | null;
  coverage: CompilerCoverage;
  binding: 'verified' | 'changed' | 'unverified' | 'unavailable';
  nodes: SourceClosureNode[];
  groups: ClosureScc[];
  summaries: Array<{ nodeId: string; facts: SourceClosureFact[] }>;
  reads: Array<{ nodeId: string; outcome: 'read' | 'missing' }>;
  omissions: ComponentSourceObservationCollection['omissions'];
  maxIterations: number;
}
export type SourceObservationFact = ClosureFact<Pick<SourceClosureFact, 'observationId' | 'ownerId' | 'kind'>>;
export function sourceClosureIdentity(location: SourceFactLocation): string {
  return `${location.canonicalPath}:${location.textHash}:${location.startOffset}:${location.endOffset}`;
}
export function mapSourceClosureLocations(
  evidence: SourceClosureEvidence,
  map: (location: SourceFactLocation) => SourceFactLocation,
): SourceClosureEvidence {
  const nodes = evidence.nodes.map((node) => ({ ...node, location: map(node.location) }));
  const bindings = nodes.map((node) => node.location.binding);
  const binding = bindings.includes('changed')
    ? 'changed'
    : evidence.reads.some((read) => read.outcome === 'missing') || bindings.includes('unavailable') || !nodes.length
      ? 'unavailable'
      : bindings.includes('unverified')
        ? 'unverified'
        : 'verified';
  return {
    ...evidence,
    binding,
    nodes,
    omissions: evidence.omissions.map((item) => ({ ...item, location: item.location ? map(item.location) : null })),
  };
}

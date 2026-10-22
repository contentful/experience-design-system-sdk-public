import type { CaptureSourceEvidenceRequest, SourceCapture } from '../steps/extraction/index.js';
import type {
  ExtractComponentsRequest,
  ExtractComponentsResponse,
  ExtractionEndpointProgress,
} from '../steps/extraction/src/types/contract.js';
import type { RawComponentDefinition } from '../steps/extraction/src/types/component.js';
import type { CompositionEdge } from '../steps/composition/src/helpers/edges/interchange-schema.js';
import type { SourceCallSiteEvidenceResult } from '../steps/composition/src/helpers/edges/source-call-site-evidence.js';
import type { ExplorationSourceInput } from '@contentful/experience-design-system-types';
import type {
  CompletedSourceEvidence,
  SourceEvidenceHandle,
  SessionSourceEnvelope,
  RawComponentWithId,
} from '../persistence/src/session/repositories/db.js';

export interface SourceAnalysisTasks {
  loadSession: {
    input: { dbPath: string; sessionId: string; handle?: SourceEvidenceHandle };
    output: { saved: CompletedSourceEvidence; raw: RawComponentWithId[] };
  };
  projectExploration: {
    input: { envelope: SessionSourceEnvelope; diagnostics?: unknown };
    output: ExplorationSourceInput;
  };
  extract: {
    input: Pick<ExtractComponentsRequest, 'filePaths' | 'projectRoot'> & {
      opts?: Pick<NonNullable<ExtractComponentsRequest['opts']>, 'resolveUnreachable' | 'evidenceFilePaths'>;
    };
    output: ExtractComponentsResponse;
  };
  capture: {
    input: Omit<CaptureSourceEvidenceRequest, 'signal'>;
    output: SourceCapture;
  };
  composition: {
    input: { files: Array<{ path: string; content: string }>; components: RawComponentDefinition[] };
    output: { extraEdges: CompositionEdge[]; sourceCallSites: SourceCallSiteEvidenceResult };
  };
}

export type SourceAnalysisTask = {
  [K in keyof SourceAnalysisTasks]: { kind: K; input: SourceAnalysisTasks[K]['input'] };
}[keyof SourceAnalysisTasks];

export type SourceAnalysisReply<K extends keyof SourceAnalysisTasks> =
  | { kind: 'progress'; progress: ExtractionEndpointProgress }
  | { kind: 'result'; result: SourceAnalysisTasks[K]['output'] }
  | { kind: 'error'; error: { name: string; message: string } };

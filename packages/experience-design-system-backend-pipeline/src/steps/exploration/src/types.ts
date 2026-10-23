import type { AgentInvoker, AgentName } from '../../../agents/index.js';
import type { AgentInvocationActivity } from '../../../agents/types/agent-run.js';
import type {
  AgentCallAttempt,
  KnownComponent,
  ExploreScope,
  ExploreScopeResult,
  ExploreAttempt,
  ExploreSourceRef,
  ExplorationIdentity,
  ExplorationSourceInput,
  ExplorationDisagreement,
  VerifyComponentWork,
  VerifyAttempt,
  VerifiedItem,
  PropertyModel,
} from '@contentful/experience-design-system-types';
export type SlotCandidates = ReadonlyArray<{
  component: string;
  source: string;
  componentId?: string;
  slots: readonly string[];
}>;
export interface StageOptions {
  representationProposalSources?: readonly ExploreRepresentationProposalSource[];
  workIds?: readonly string[];
  component?: string;
  source?: string;
  invoker: Pick<AgentInvoker, 'invoke'>;
  agent: AgentName;
  model?: string;
  bedrock?: boolean;
  outDir: string;
  timeoutMs: number;
  operationTimeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
  skillContentOverride?: string;
  skillPathOverride?: string;
  signal?: AbortSignal;
  preserveConversation?: boolean;
  identity?: ExplorationIdentity;
  sourceInput?: ExplorationSourceInput;
  sourceRefs?: ExploreSourceRef[];
  existingComponentsInline?: string;
  existingTokensInline?: string;
  existingContextStatus?: { status: 'absent' | 'available' | 'unavailable' | 'omitted'; reason?: string };
  onAttempt?: (attempt: AgentCallAttempt) => void | Promise<void>;
  onInvocation?: (activity: AgentInvocationActivity) => void;
}
export interface ExploreStageRequest extends StageOptions {
  responseCache?: {
    load: (key: string) => string | undefined;
    save: (key: string, output: string) => void;
    hit: (key: string, scope: ExploreScope) => void;
  };
  scopes: readonly ExploreScope[];
  requestedComponents?: readonly KnownComponent[];
  rawComponentsInline?: string;
  rawComponents?: readonly import('../../extraction/src/types/component.js').RawComponentDefinition[];
  slotCandidates?: SlotCandidates;
  propBucketsInline?: string;
  callSiteEvidenceInline?: string;
  callSiteEvidencePath?: string;
  sharedSource?: import('@contentful/experience-design-system-types').SharedSource;
  rawTokensInline?: string;
  rawTokensFilename?: string;
  projectRoot?: string;
  sdkReferencePath?: string;
  rendererReferenceInline?: string;
  existingModelPath?: string;
  onScopeStart?: (scope: ExploreScope) => void;
  onScopeComplete?: (result: ExploreScopeResult) => void | Promise<void>;
}
export interface ExploreRepresentationProposalSource {
  component: string;
  source: string;
  properties: readonly PropertyModel[];
}
export interface TierStageRequest extends StageOptions {
  disagreements: ExplorationDisagreement[];
}
export interface VerifyStageRequest extends Omit<StageOptions, 'onAttempt'> {
  components: VerifyComponentWork[];
  concurrency?: number;
  onAttempt?: (attempt: VerifyAttempt) => void | Promise<void>;
}
export interface CheckStageRequest extends VerifyStageRequest {
  verified: VerifiedItem[];
}
export type { ExploreAttempt };

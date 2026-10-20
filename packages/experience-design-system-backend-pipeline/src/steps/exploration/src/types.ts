import type { AgentInvoker, AgentName } from '../../../agents/index.js';
import type {
  AgentCallAttempt,
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
} from '@contentful/experience-design-system-types';
export type SlotCandidates = ReadonlyArray<{
  component: string;
  source: string;
  componentId?: string;
  slots: readonly string[];
}>;
export interface StageOptions {
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
  identity?: ExplorationIdentity;
  sourceInput?: ExplorationSourceInput;
  sourceRefs?: ExploreSourceRef[];
  maxPromptBytes?: number;
  onAttempt?: (attempt: AgentCallAttempt) => void | Promise<void>;
}
export interface ExploreStageRequest extends StageOptions {
  scopes: readonly ExploreScope[];
  rawComponentsInline: string;
  slotCandidates?: SlotCandidates;
  propBucketsInline?: string;
  callSiteEvidenceInline?: string;
  callSiteEvidencePath?: string;
  sharedSource?: import('@contentful/experience-design-system-types').SharedSource;
  rawTokensInline?: string;
  rawTokensFilename?: string;
  existingTokensInline?: string;
  existingComponentsInline?: string;
  projectRoot?: string;
  sdkReferencePath?: string;
  rendererReferenceInline?: string;
  existingModelPath?: string;
  onScopeComplete?: (result: ExploreScopeResult) => void | Promise<void>;
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

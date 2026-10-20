import type { EXPLORE_SCOPES } from './constants.js';
export type ExploreScope = (typeof EXPLORE_SCOPES)[number];
export type DiffScope = 'component' | 'prop' | 'slot';
export type SourceCompleteness = 'complete-within-declared-bound' | 'partial' | 'unavailable';
export interface ExplorationIdentity {
  sessionId: string;
  runId: string;
  envelopeId: string;
  digest: string;
}
export interface KnownComponent {
  name: string;
  source: string;
  componentId?: string;
}
export interface VerifyEvidence {
  source: string;
  line: string;
  quote: string;
}
export interface SlotRestriction {
  kind: 'declared' | 'enforced';
  applicable: boolean;
  evidence: VerifyEvidence[];
  supported?: boolean;
}
export interface ExploreSlotEvidence {
  name: string;
  isRealSlot: boolean;
  allowedComponents?: string[];
  evidence?: string[];
  required?: boolean;
  reasoning?: string;
  restriction?: SlotRestriction;
}
export interface ExplorePropReport {
  name: string;
  category?: 'content' | 'design' | 'state' | 'unattached';
  type?: string;
  values?: unknown[];
  tokenKind?: string;
  tokenPaths?: string[];
  required?: boolean;
  default?: unknown;
  description?: string;
  reasoning?: string;
}
export interface ExploreComponentReport extends KnownComponent {
  included?: boolean;
  inclusionReasoning?: string;
  modelingNotes?: string[];
  props?: ExplorePropReport[];
  slots?: ExploreSlotEvidence[];
}
export interface ExploreCompanion {
  agentRole: ExploreScope;
  components: ExploreComponentReport[];
  rawTokenReferences?: Array<{ tokenPath: string; file: string; line: number; property: string }>;
}
export interface AgentCallAttempt {
  attempt: number;
  ok: boolean;
  error?: string;
  stage?: string;
  operationId?: string;
  component?: string;
  source?: string;
  workIds?: readonly string[];
  scope?: ExploreScope;
  identity?: ExplorationIdentity;
  startedAt?: string;
  durationMs?: number;
}
export interface ExploreAttempt extends AgentCallAttempt {
  scope: ExploreScope;
}
export interface ExploreScopeResult {
  scope: ExploreScope;
  report: string;
  companion: ExploreCompanion;
  attempts: ExploreAttempt[];
}
export type ExploreStageResult =
  | { ok: true; scopes: ExploreScopeResult[] }
  | { ok: false; scope: ExploreScope; attempts: ExploreAttempt[]; error: string; scopes?: ExploreScopeResult[] };
export interface ExploreSourceRef {
  component: string;
  sourcePath: string;
  content: string | null;
  sourceEvidence?: {
    captureId: string;
    captureDigest: string;
    textHash: string | null;
    coverage: SourceCompleteness;
    extractionByteBinding: 'verified-same' | 'changed' | 'unverified';
    lineRanges: Array<{ startLine: number; endLine: number }>;
  };
  siblingFiles?: Array<{ path: string; content: string; sourceEvidence?: ExploreSourceRef['sourceEvidence'] }>;
}
export interface BoundSourceFile {
  fileId: string;
  path: string;
  textHash: string | null;
  ranges: Array<{ startLine: number; endLine: number; text: string }>;
  coverage: SourceCompleteness;
  roles?: string[];
  componentRefs?: Array<{
    componentId: string;
    name: string;
    roles: string[];
    observations?: Array<{ role: string; startLine: number; endLine: number }>;
  }>;
}
export interface ExplorationSourceInput {
  projectionBounds?: { maxBytes: number; usedBytes: number };
  components?: import('../shared-source.js').SharedSource['components'];
  omittedComponents?: number;
  omittedRanges?: number;
  captureId: string;
  captureDigest: string;
  envelopeId: string;
  envelopeDigest: string;
  coverage: SourceCompleteness;
  promptCoverage: SourceCompleteness;
  extractionByteBinding: 'verified-same' | 'changed' | 'unverified';
  files: BoundSourceFile[];
  omittedFiles: number;
  omittedDiagnostics?: number;
  omittedObservations?: number;
  diagnostics: unknown[];
  observations: { accepted: unknown[]; rejected: unknown[] };
}
export interface ExplorationDisagreement {
  id: string;
  component: string;
  source: string;
  scope: DiffScope;
  member?: string;
  field: string;
  path: string;
  valuesByScope: Partial<Record<ExploreScope, unknown>>;
  reasonsByScope: Partial<Record<ExploreScope, string>>;
  existenceDispute?: boolean;
}
export interface ExplorationSingleVoter {
  id: string;
  component: string;
  source: string;
  scope: DiffScope;
  member?: string;
  field: string;
  path: string;
  provider: ExploreScope;
  value: unknown;
  reason?: string;
}
export interface ExplorationConsensusField {
  path: string;
  value: unknown;
  coverage: number;
  providers: ExploreScope[];
}
export interface ExplorationDiff {
  consensus: ExplorationConsensusField[];
  disagreements: ExplorationDisagreement[];
  singleVoters: ExplorationSingleVoter[];
  warnings: string[];
  scopesRead: number;
  componentsSeen: number;
}
export interface DerivedSelection {
  componentKey: string;
  componentId?: string;
  name: string;
  source: string;
  decision?: 'accepted' | 'rejected';
  reason: string;
  votes: { accepted: number; rejected: number };
  dissent: Array<{ scope: string; included: boolean; reason: string }>;
  disputed: boolean;
}
export type AcceptedSlotState = 'false' | 'unresolved' | 'open' | 'finite';
export interface DerivedSlot {
  name: string;
  allowedComponents: string[];
  state?: AcceptedSlotState;
  required?: boolean;
  evidence?: VerifyEvidence[];
}
export interface DerivedComponentSlots extends KnownComponent {
  slots: DerivedSlot[];
}
export interface SlotDecision extends KnownComponent {
  slot: string;
  state: AcceptedSlotState;
  allowedComponents: string[];
  required?: boolean;
  evidence: VerifyEvidence[];
  coverage: number;
  realVotes: number;
  description?: string;
  provenance?: 'source-consensus' | 'human';
  disputes?: SlotDispute[];
}
export interface SlotDispute {
  component: string;
  source: string;
  slot: string;
  field: 'isRealSlot' | 'allowedComponents';
  disputeId: string;
  valuesByScope: Record<string, unknown>;
  reasonsByScope: Record<string, string | undefined>;
}
export interface DerivedSlots {
  components: DerivedComponentSlots[];
  disputes: SlotDispute[];
  decisions: SlotDecision[];
}
export type HypothesisTier = 'factual' | 'interpretive';
export interface TierHypothesis {
  disagreementIds: string[];
  hypothesis: string;
  tier: HypothesisTier;
  tierReason: string;
  gatedOn?: 'category';
}
export type TierStageResult =
  | { ok: true; hypotheses: TierHypothesis[]; attempts: AgentCallAttempt[] }
  | { ok: false; error: string; attempts: AgentCallAttempt[] };
export type VerifyOutcome = 'confirmed' | 'resolved' | 'conflicting';
export type VerifyItemKind = 'factual' | 'single-voter';
export interface VerifyClaim {
  id: string;
  path: string;
  scope: DiffScope;
  member?: string;
  field: string;
  valuesByScope: Partial<Record<ExploreScope, unknown>>;
}
export interface VerifyItem {
  itemId: string;
  kind: VerifyItemKind;
  hypothesis?: string;
  gatedOn?: 'category';
  claims: VerifyClaim[];
}
export interface VerifyCallSite {
  sourcePath: string;
  startLine: number;
  endLine: number;
  child: string;
  excerpt: string;
}
export interface VerifyComponentWork {
  component: string;
  source: string;
  sourceRef?: ExploreSourceRef;
  callSites: VerifyCallSite[];
  items: VerifyItem[];
}
export interface VerifyResolution {
  path: string;
  value: unknown;
}
export interface VerifiedItem {
  itemId: string;
  component: string;
  source: string;
  outcome: VerifyOutcome;
  resolved?: VerifyResolution[];
  evidence: VerifyEvidence[];
  reason: string;
  downgraded?: boolean;
}
export interface VerifyAttempt extends AgentCallAttempt {
  component: string;
}
export type VerifyStageResult =
  | { ok: true; items: VerifiedItem[]; attempts: VerifyAttempt[] }
  | { ok: false; component: string; error: string; attempts: VerifyAttempt[] };
export type CheckVerdict = 'supports' | 'does-not-support' | 'unclear';
export interface EvidenceCheck {
  checkId: string;
  itemId: string;
  component: string;
  source: string;
  verdict: CheckVerdict;
  reason: string;
}
export type CheckStageResult =
  | { ok: true; items: VerifiedItem[]; checks: EvidenceCheck[]; attempts: VerifyAttempt[] }
  | { ok: false; component: string; error: string; attempts: VerifyAttempt[] };
export type RendererReferenceInput =
  | { kind: 'url'; url?: string }
  | { kind: 'path'; path: string }
  | { kind: 'text'; text: string; origin: string };
export interface RendererReference {
  origin: string;
  digest: string;
  retrievedAt: string;
  bytes: number;
  coverage: 'complete-within-declared-bound';
  text: string;
}
export interface ExplorationDetailRecord {
  diff: ExplorationDiff;
  hypotheses: TierHypothesis[];
  verified: VerifiedItem[];
  checks: EvidenceCheck[];
  recordOnly: true;
}

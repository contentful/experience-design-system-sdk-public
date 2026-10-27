// Agent-process + prompt-transport primitives — reusable helpers for
// spawning agent CLIs with timeouts/stdin/prompt-artifact support. Dormant
// on `development`: no current caller uses these. Pre-landed from the
// in-flight import-pipeline refactor so follow-up work can depend on
// them without re-introducing the plumbing. See INTEG-4927.
export { shouldUseStdinForPrompt } from './agent-prompt-transport.js';
export {
  createAgentPromptArtifact,
  shouldUsePromptArtifact,
  type AgentPromptArtifact,
} from './agent-prompt-artifact.js';
export {
  createAgentCancellationResult,
  runAgentProcess,
  type AgentProcessEndDetails,
  type AgentProcessResult,
  type RunAgentProcessOptions,
} from './agent-process-lifecycle.js';

// CDF (Component Definition Format) exports — one schema/file for both
// components and design tokens, no separate manifest envelope.
export {
  validateCDF,
  parseCDFComponents,
  CDF_SCHEMA_URL,
  cdfJsonSchema,
  CDF_PROPERTY_TYPES,
  CDF_PROPERTY_CATEGORIES,
  CDFComponentSchema,
  CDFPropertySchema,
  CDFSlotSchema,
  CDFTokenSchema,
  buildCDF,
  buildFilteredCDF,
  stripUnsupportedSlotFields,
  validateSlotReferences,
  type CDFComponentEntry,
  type CDFPropertyDefinition,
  type CDFSlotDefinition,
  type CDFTokenEntry,
  type CDFValidationError,
  type CDFValidationResult,
  type CDFDocument,
} from './cdf/index.js';

// DTCG (W3C Design Token Community Group)
export {
  DESIGN_TOKEN_TYPES,
  flattenDTCG,
  validateDTCG,
  DTCGTokenSchema,
  type DesignTokenType,
  type DTCGTokenEntry,
  type DTCGTokenGroup,
  type DTCGTokenNode,
  type DTCGTokenGroupNode,
  type DTCGValidationError,
  type DTCGValidationResult,
} from './dtcg/index.js';

// Sources API — Preview
export type {
  BreakingChange,
  ChangeClassification,
  DownstreamImpact,
  PropertySummary,
  ComponentTypeSummary,
  DesignTokenSummary,
  TaxonomySummary,
  ChangedEntity,
  EntityDiffGroup,
  ServerPreviewResponse,
} from './sources-api/preview/index.js';

// Sources API — Apply
export type {
  ApplyOperationStatus,
  ApplyOperationItemError,
  ApplyOperationItem,
  ApplyOperationResponse,
  ApplyGateError,
} from './sources-api/apply/index.js';

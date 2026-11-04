// CDF (Component Definition Format) exports — one schema/file for both
// components and design tokens, no separate manifest envelope.
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
  finiteValuesIssue,
  isFinitePrimitiveType,
  isFinitePrimitiveValue,
  type FinitePrimitiveType,
  type FinitePrimitiveValue,
  type CDFComponentEntry,
  type CDFPropertyDefinition,
  type CDFFieldDefinition,
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

export * from './exploration/index.js';
export type {
  SharedSource,
  SharedSourceFile,
  SharedSourceCompilerContext,
  SharedSourceReference,
  SharedSourceRange,
  SharedSourceCoverage,
  SharedSourceCallerCoverage,
} from './shared-source.js';

export * from './property-contract/index.js';
export {
  validateCDFProperty,
  cdfToTarget,
  targetToCDF,
  cdfDefinitionChildren,
  containsCDFDefinitionType,
} from './cdf/property-validation.js';

export * from './source-input-association.js';

export {
  PROPERTY_BREAKING_REASONS,
  SLOT_BREAKING_REASONS,
  sanitizeBreakingChanges,
} from './sources-api/preview/index.js';
export type { SlotSummary, ProjectionDiagnostic } from './sources-api/preview/index.js';

export * from './schema-export.js';

export { previewContractSchemas } from './sources-api/preview/schema.js';

export { expandCDFModelDependencies } from './cdf/build.js';

export { toOpenAPISchema } from './schema-export.js';

export type { ProposedComponentSummary } from './sources-api/preview/index.js';

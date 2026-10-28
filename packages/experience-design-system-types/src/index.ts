// Shared-source + source-input-association types.
// SharedSource describes the source-file inventory delivered through the
// pipeline; SourceInputAssociation ties a CDF-authoring field back to the
// resolved source identity that owns it. Pre-landed from the parallel
// in-flight work on #420; no current consumer imports these. See INTEG-4927.
export type {
  SharedSource,
  SharedSourceFile,
  SharedSourceCompilerContext,
  SharedSourceReference,
  SharedSourceRange,
  SharedSourceCoverage,
  SharedSourceCallerCoverage,
} from './shared-source.js';
export * from './source-input-association.js';

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
  finiteValuesIssue,
  isFinitePrimitiveType,
  isFinitePrimitiveValue,
  type FinitePrimitiveType,
  type FinitePrimitiveValue,
  type CDFComponentEntry,
  type CDFFieldDefinition,
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

// Property contract — pillar #4 foundation (target types + validators).
// Dormant: no current consumer imports these. Available for forthcoming
// evidence-aware extractors and generation. See INTEG-5147 / INTEG-4927.
export * from './property-contract/index.js';

// CDF property validation over the property contract. Dormant: the live
// `validateCDF` path still uses `CDFPropertySchema`. See INTEG-4927.
export {
  validateCDFProperty,
  cdfToTarget,
  targetToCDF,
  cdfDefinitionChildren,
  containsCDFDefinitionType,
} from './cdf/property-validation.js';

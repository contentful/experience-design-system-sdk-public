// CDF (Component Definition Format) exports
export {
  validateCDF,
  parseCDFComponents,
  CDF_V1_SCHEMA_URL,
  CDF_PROPERTY_TYPES,
  CDF_PROPERTY_CATEGORIES,
  type CDFComponentEntry,
  type CDFPropertyDefinition,
  type CDFSlotDefinition,
  type CDFValidationError,
} from './cdf/index.js';

// DTCG (W3C Design Token Community Group)
export {
  DESIGN_TOKEN_TYPES,
  flattenDTCG,
  validateDTCG,
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

// Sources API — Manifest
export type { ManifestPayload } from './sources-api/manifest/index.js';
export { buildManifest, buildFilteredManifest, stripUnsupportedSlotFields } from './sources-api/manifest/index.js';

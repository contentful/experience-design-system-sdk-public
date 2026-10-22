export {
  collectComponentSourceObservations,
  DEFAULT_COMPONENT_OBSERVATION_LIMITS,
} from './src/component-facts/collect-component-source-observations.js';
export type { ComponentSourceObservationOptions } from './src/component-facts/collect-component-source-observations.js';
export type {
  ComponentObservationLimits,
  ComponentSourceObservationCollection,
  ComponentSourceObservation,
  SourceObservationContext,
  SourceInputAccessPath,
  SourceAccessSegment,
  SourceObservationOperand,
  SourceSymbolEvidence,
  SourceDeclarationOrigin,
  SourceCallableSignature,
  SourceObservationType,
} from './src/types/component-source-observations.js';
export { assembleComponentFacts } from './src/component-facts/assemble-component-facts.js';
export { COMPONENT_FACT_SCHEMA_VERSION } from './src/types/component-facts.js';
export type {
  ComponentFacts,
  ComponentFactObservation,
  ComponentEvidenceReadStatus,
  ComponentFactContext,
  ComponentFactInput,
  ComponentFactCollectors,
  RenderableFact,
  MemberFact,
  ChildFilterFact,
  RequiresParentFact,
  NonStaticFact,
  ComponentOriginFact,
  ReferencedOriginFact,
} from './src/types/component-facts.js';

// Models and public contracts
export type {
  RawComponentDefinition,
  RawPropDefinition,
  RawSlotDefinition,
  ComponentExtractionResult,
  ExtractionExclusion,
  ExtractorProgress,
  ExtractionValidationIssue,
  ExtractionValidationIssueCode,
} from './src/types/component.js';
export {
  mergeSourceCandidates,
  retainDuplicateSourceCandidates,
  describeSourceDomain,
  observeRawProps,
  observeTypeProps,
} from './src/candidates/source-candidates.js';
export {
  extractSourceDefaultExpressions,
  extractSourceDefaultNodes,
} from './src/framework-adapters/react/helpers/extract-react-binding-defaults.js';
export { SOURCE_FACT_SCHEMA_VERSION, SUPPORTED_SOURCE_FACT_SCHEMA_VERSIONS } from './src/candidates/types.js';
export {
  bindSourceCandidatesToCapture,
  bindSourceClosureToCapture,
  bindCompilerReadsToCapture,
} from './src/candidates/bind-source-candidates.js';
export { mergeExtractionDiagnostics, recordSourceCandidateDiagnostics } from './src/compiler/diagnostics.js';
export { createCompilerContexts } from './src/compiler/context.js';
export type {
  CompilerPropFact,
  CompilerCoverage,
  CompilerModuleDiagnostic,
  CompilerProjectDiagnostic,
  CompilerReferenceDiagnostic,
  ExtractionDiagnostics,
  SourceCandidate,
  SourceCandidateCollection,
  SourceCandidateObservation,
  SourceSyntaxObservation,
  VueSyntaxObservation,
  WebComponentSyntaxObservation,
  SourceCandidateSource,
  SourceDefaultFact,
  SourceDomain,
  SourceDomainLiteral,
  SourceEvidenceKind,
  SourceFactBinding,
  SourceFactCertainty,
  SourceFactLocation,
  SourceFactOrigin,
} from './src/candidates/types.js';
export type { CompilerContextResult, CompilerProjectContext } from './src/compiler/context.js';
export type { ExtractorOptions } from './src/types/options.js';
export type { ComponentExtractor } from './src/types/component-extractor.js';

// Core extraction pipeline
export { extractComponents } from './src/services/extraction/extract-components.js';
export { extractEndpoint } from './src/controller/extract-controller.js';
export type {
  ExtractionEndpointProgress,
  ExtractionEndpointRequest,
  ExtractionEndpointResponse,
} from './src/types/contract.js';

// Framework-specific extractors
export { extractReactComponents } from './src/framework-adapters/react/extractor.js';
export { extractVueComponents } from './src/framework-adapters/vue/extractor.js';
export { extractVueTsxComponents } from './src/framework-adapters/vue-tsx/extractor.js';
export {
  collectVueSourceCandidates,
  createVueSfcCompilerContexts,
} from './src/framework-adapters/vue/helpers/collect-vue-source-candidates.js';
export type {
  VueSfcCompilerContexts,
  VueSfcCompilerInput,
} from './src/framework-adapters/vue/helpers/collect-vue-source-candidates.js';
export { extractStencilComponents } from './src/framework-adapters/stencil/extractor.js';
export { extractAstroComponents } from './src/framework-adapters/astro/extractor.js';
export {
  readWebComponentSyntax,
  collectWebComponentClasses,
  createWebComponentCompilerContexts,
} from './src/framework-adapters/web-components/helpers/read-wc-syntax.js';
export type { WebComponentClass } from './src/framework-adapters/web-components/helpers/read-wc-syntax.js';
export { extractWebComponentDefinitions } from './src/framework-adapters/web-components/extractor.js';
export { extractSvelteComponents } from './src/framework-adapters/svelte/extractor.js';
export {
  extractAllowedComponentsFromTypeText,
  extractAllowedComponentsFromJsdoc,
} from './src/helpers/evidence/collect-allowed-component-names.js';

// Post-extraction quality review
export { evaluateExtractionQuality } from './src/services/quality/evaluate-extraction-quality.js';
export { hasNoAuthoringSurface } from './src/services/quality/helpers/authorability/evaluate-authorability.js';
// Backwards-compatible alias for callers that used the pre-refactor name
export { hasNoAuthoringSurface as isNonAuthorableComponent } from './src/services/quality/helpers/authorability/evaluate-authorability.js';
export {
  inspectComponentSource,
  describeReviewReasons,
  describeReviewReason,
  isDataWrapperReviewReason,
  HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON,
  POSSIBLE_DATA_FETCH_WRAPPER_REASON,
  ZERO_SURFACE_RENDERED_UI_REASON,
} from './src/services/quality/helpers/inspection/inspect-component-source.js';
export type { ComponentSourceInspection } from './src/types/source-inspection.js';

// Validation
export {
  validateExtractedComponents,
  shouldExcludeDueToValidation,
  formatExclusionWarning,
  formatExcludedComponentLines,
} from './src/services/quality/helpers/inspection/validate-extracted-components.js';
export { parseImportedNames } from './src/helpers/evidence/parse-source-imports.js';

// Bounded, plain-data source evidence for completed extraction sessions.
export { captureSourceEvidence, DEFAULT_SOURCE_CAPTURE_LIMITS } from './source-evidence/index.js';
export type {
  CapturedSourceFile,
  CapturedCompilerContext,
  CaptureSourceEvidenceRequest,
  ExtractionByteBinding,
  SourceCapture,
  SourceCaptureDiagnostic,
  SourceCaptureLimits,
  SourceComponentReference,
  SourceCoverage,
  SourceResolution,
  SourceResolutionOutcome,
} from './source-evidence/index.js';

// Slot detection helpers
export {
  CONTENT_NAME_EXCEPTIONS,
  isReactNodeType,
  isArrayReactNodeType,
  shouldBeSlot,
} from './src/helpers/evidence/detect-slot-from-prop.js';

// Pre-classification
export { preClassifyProp, preClassifyComponent } from './src/services/classification/classify-component-props.js';
export { bucketComponentProps, bucketComponentsProps } from './src/services/classification/bucket-component-props.js';
export type { PreClassification, PropBucketAssignment } from './src/types/classification.js';

export type { NativeSourceShape, SourceTypeGraph, SourceTypeNode, SourceJsonValue } from './src/candidates/types.js';

export { collectReactSourceObservations } from './src/framework-adapters/react/helpers/collect-react-source-observations.js';
export { extractTsxComponents } from './src/framework-adapters/shared/helpers/tsx-shared.js';

export * from './source-closure/index.js';
export { collectSourceClosure } from './source-closure/source-adapter.js';
export { SOURCE_CLOSURE_SCHEMA_VERSION, mapSourceClosureLocations } from './source-closure/source-evidence.js';
export type {
  SourceClosureCaptureBinding,
  SourceClosureEvidence,
  SourceClosureNode,
  SourceClosureEnd,
  SourceClosureFact,
} from './source-closure/source-evidence.js';
export { readSourceClosure, sourceClosureMatchesObservations } from './source-closure/validation.js';
export { readInputOutput } from './src/component-facts/input-output-validation.js';
export { mapInputOutputLocations } from './src/types/source-input-output.js';
export type {
  SourceInputOutputEvidence,
  SourceDeclaredInput,
  SourceInputOutputWitness,
  SourceOutputDestination,
} from './src/types/source-input-output.js';
export { canonicalSourceFactPath } from './src/candidates/bind-source-candidates.js';
export { discoverSourceEvidence, DEFAULT_SOURCE_DISCOVERY_LIMITS } from './source-evidence/discovery.js';
export type { SourceEvidenceInventory, SourceDiscoveryLimits } from './source-evidence/discovery.js';
export type {
  SourceReferenceIndex,
  SourceCompilerReference,
  SourceCallerValue,
  SourceCallerSummary,
} from './src/types/source-references.js';
export { readSourceReferences } from './src/component-facts/source-reference-validation.js';
export { mapReferenceIndexLocations } from './src/types/source-references.js';
export { compilerSourcesFromContexts } from './src/compiler/context.js';
export type { CompilerLoadedSource } from './src/compiler/context.js';
export { readSourceInventory } from './source-evidence/discovery-validation.js';

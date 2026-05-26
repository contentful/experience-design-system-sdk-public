# @contentful/experience-design-system-types

Shared TypeScript types for the Contentful Experience Design System import pipeline. Covers the two file formats consumers provide (CDF for components, DTCG for tokens) and the contract types for the Design System Sources API.

## Modules

### CDF — Component Definition Format

Types and validation for `.cdf.json` component definition files that describe a design system's component library. Exports `validateCDF`, `CDF_V1_SCHEMA_URL`, `CDF_PROPERTY_TYPES`, `CDFComponentEntry`, `CDFPropertyDefinition`, `CDFValidationError`.

### DTCG — Design Token Community Group

Types for `.tokens.json` files in the [W3C DTCG format](https://tr.designtokens.org/format/) that describe a design system's token library. Exports `DESIGN_TOKEN_TYPES`, `DesignTokenType`, `DTCGTokenEntry`, `DTCGTokenGroup`, `DTCGTokenNode`, `DTCGTokenGroupNode`.

### Sources API — Manifest

Request body sent to both the preview and apply endpoints. Exports `ManifestPayload`.

### Sources API — Preview

Response types for the Sources API preview endpoint, which returns a diff of what will change before committing. Exports `ServerPreviewResponse`, `EntityDiffGroup`, `ChangedEntity`, `BreakingChange`, `ChangeClassification`, `DownstreamImpact`, and entity summary types (`ComponentTypeSummary`, `DesignTokenSummary`, `TaxonomySummary`, `PropertySummary`).

### Sources API — Apply

Response types for the Sources API apply endpoint, which runs the async import operation. Exports `ApplyOperationResponse`, `ApplyOperationItem`, `ApplyOperationItemError`, `ApplyOperationStatus`, `ApplyGateError`.

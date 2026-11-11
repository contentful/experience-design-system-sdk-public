# @contentful/experience-design-system-types

Shared TypeScript types, Zod schemas, and JSON schema validators for the Contentful Experience Design System import pipeline.

This package is a bundled dependency of `@contentful/experience-design-system-cli`. You generally don't need to install it directly — the CLI brings it in. Use it when you want to validate or generate CDF/DTCG files in your own tooling.

## Formats

### CDF — Component Definition Format

One typed, validated document for a design system's components and design tokens together — the request body sent to both the preview and apply endpoints. A leaf's `$type` decides what it is (`'component'` vs. a `DESIGN_TOKEN_TYPES` member), so groups can nest either kind side by side. There is no separate manifest envelope.

**Exports:** `validateCDF`, `parseCDFComponents`, `buildCDF`, `buildFilteredCDF`, `validateSlotReferences`, `CDF_SCHEMA_URL`, `CDF_PROPERTY_TYPES`, `CDFComponentEntry`, `CDFTokenEntry`, `CDFPropertyDefinition`, `CDFValidationError`, `CDFValidationResult`, `CDFDocument`

### DTCG — Design Token Community Group

Types for standalone `.tokens.json` files following the [W3C DTCG format](https://tr.designtokens.org/format/) — used when generating or ingesting raw design tokens ahead of merging them into a CDF document.

**Exports:** `DESIGN_TOKEN_TYPES`, `DesignTokenType`, `DTCGTokenEntry`, `DTCGTokenGroup`, `DTCGTokenNode`, `DTCGTokenGroupNode`

### Sources API — Preview

Response types for the Sources API preview endpoint, which returns a diff of what will change before committing.

**Exports:** `ServerPreviewResponse`, `EntityDiffGroup`, `ChangedEntity`, `BreakingChange`, `ChangeClassification`, `DownstreamImpact`, `ComponentTypeSummary`, `DesignTokenSummary`, `TaxonomySummary`, `PropertySummary`

### Sources API — Apply

Response types for the Sources API apply endpoint, which runs the async import operation.

**Exports:** `ApplyOperationResponse`, `ApplyOperationItem`, `ApplyOperationItemError`, `ApplyOperationStatus`, `ApplyGateError`

## Entry points

The root export (`@contentful/experience-design-system-types`) holds the formats above. Two more entry points are imported by path:

### `./config`

Where the CLI keeps its files on disk (`~/.contentful/experience-design-system-cli/`, relocated by `EDS_HOME`) and how settings are read and written. It is the only module that knows these paths.

**Exports:** `configRoot`, `configFilePath`, `runsFilePath`, `debugSessionsDir`, `oldConfigDir`, `readSettings`, `writeSettings`, `updateSettings`, `Settings`

### `./handoff`

The shape of the data the import hands from one stage to the next (`ExtractionHandoff`, `GenerationHandoff`), with a schema, and functions to write it to and read it from the `EDS_IMPORT_HANDOFF` environment variable.

**Exports:** `HANDOFF_ENV`, `serializeHandoff`, `parseHandoff`, `ImportHandoff`, `ExtractionHandoff`, `GenerationHandoff`, `ParsedHandoff`

## Development

```bash
# Build
pnpm -F @contentful/experience-design-system-types build

# Test
pnpm -F @contentful/experience-design-system-types test

# Typecheck
pnpm -F @contentful/experience-design-system-types typecheck
```

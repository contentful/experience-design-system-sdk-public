# @contentful/experience-design-system-types

Shared TypeScript types, Zod schemas, and JSON schema validators for the Contentful Experience Design System import pipeline.

This package is a bundled dependency of `@contentful/experience-design-system-cli`. You generally don't need to install it directly — the CLI brings it in. Use it when you want to validate or generate CDF/DTCG files in your own tooling.

## Formats

### CDF — Component Definition Format

Typed and validated structure for `.cdf.json` component definition files that describe a design system's component library.

**Exports:** `validateCDF`, `CDF_V1_SCHEMA_URL`, `CDF_PROPERTY_TYPES`, `CDFComponentEntry`, `CDFPropertyDefinition`, `CDFValidationError`

### DTCG — Design Token Community Group

Types for `.tokens.json` files following the [W3C DTCG format](https://tr.designtokens.org/format/) that describe a design system's token library.

**Exports:** `DESIGN_TOKEN_TYPES`, `DesignTokenType`, `DTCGTokenEntry`, `DTCGTokenGroup`, `DTCGTokenNode`, `DTCGTokenGroupNode`

### Sources API — Manifest

Request body sent to both the preview and apply endpoints.

**Exports:** `ManifestPayload`

### Sources API — Preview

Response types for the Sources API preview endpoint, which returns a diff of what will change before committing.

**Exports:** `ServerPreviewResponse`, `EntityDiffGroup`, `ChangedEntity`, `BreakingChange`, `ChangeClassification`, `DownstreamImpact`, `ComponentTypeSummary`, `DesignTokenSummary`, `TaxonomySummary`, `PropertySummary`

### Sources API — Apply

Response types for the Sources API apply endpoint, which runs the async import operation.

**Exports:** `ApplyOperationResponse`, `ApplyOperationItem`, `ApplyOperationItemError`, `ApplyOperationStatus`, `ApplyGateError`

## Development

```bash
# Build
pnpm -F @contentful/experience-design-system-types build

# Test
pnpm -F @contentful/experience-design-system-types test

# Typecheck
pnpm -F @contentful/experience-design-system-types typecheck
```

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

## Native property contracts

- CDF properties support `array` with `$items` and `record` with nonempty `$fields`; both retain recursive descriptions, declared values and explicit requiredness.
- Defaults are JSON values with own presence: omission differs from `null`, `false`, `0`, `""`, `[]` and `{}`; classification decisions can explicitly set or clear them.
- `validateCDF` and `validateCDFProperty` enforce structural placement, safe JSON values, recursive typed defaults and declared domains; the exported JSON Schemas describe structure and require runtime validation for contextual semantics.
- Record dictionaries preserve opaque own keys, including `__proto__`, dots, slashes and Unicode; keys are never interpreted as paths.
- The eleven target forms are a modeling vocabulary; `createPropertyProfile` snapshots revision 2 mapper capabilities, and `projectProperty` requires explicit recursive caller context.
- The local native profile permits root Array, root Record and direct Array<Record>; deeper source graphs and representation drafts remain saved with explicit unsupported admission.
- A projected default requires support from both its source mapper type and its mapped target; the profile default target allowlist is String, Number, Boolean, Array and Record.
- Source graphs remain separate from category, representation, default intent and projection outcomes, with bounded coverage and original expressions for defaults that cannot be decoded without execution.
- `parseRepresentationProposalDrafts` stages typed drafts without persistence; `validateRepresentationProposal` binds source identity and graph references and obtains readiness from the caller.
- Modeling, local serialization and schema acceptance do not establish remote mapper, rendering, resource identity or deployment readiness.
- Review preserves recursive definitions on unrelated edits, refuses unsupported structural/default edits and publishes saved state only after a successful database write.
- Preview compares supplied recursive definitions by value; a previous summary without a definition remains unknown.

## Development

```bash
# Build
pnpm -F @contentful/experience-design-system-types build

# Test
pnpm -F @contentful/experience-design-system-types test

# Typecheck
pnpm -F @contentful/experience-design-system-types typecheck
```

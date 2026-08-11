# ADR 0002: Real-Time Preview Feedback in Analyze-Select Editor

## Status

Accepted

## Date

2026-05-19

## Original ADR number

Curated into this repo as ADR-0002 (original numbering, planning workspace: ADR-0004).

## Context

The `exo import` wizard includes an interactive analyze-select TUI editor where users review extracted components, edit props (add/remove/modify), and accept or reject them before generation. The editor shows server-side preview annotations (`⚠ breaking`, `new`, `changed`, `unchanged`) to give real-time feedback on how edits affect the Contentful environment.

The preview pipeline works as follows:
1. `loadCDFComponents(db, sessionId)` reads props with `WHERE cdf_type IS NOT NULL`
2. Builds a CDF manifest from those props
3. Sends the manifest to the preview backend's endpoint
4. Server compares against existing entities and classifies changes

Two distinct bugs prevented real-time preview feedback:

### Bug 1: CDF columns wiped on editor save

When the user saves an edit (Ctrl+S), `handleDraftSave` calls `storeRawComponents()` which performs a DELETE-and-re-insert of all components. This wipes the `cdf_type`, `cdf_category`, and `cdf_token_kind` columns that were populated by a prior `generate components` run. After the save, `loadCDFComponents` returns zero props — the preview effectively freezes.

### Bug 2: No CDF data without a prior generate run

`loadCDFComponents` filters `WHERE cdf_type IS NOT NULL`, so components that have never been through the `generate` step have zero props in the manifest. The server receives a component entry with empty `$properties`, which produces an empty `comparisonDefinition`. Since the server's diff logic (`computeEntityDiff`) compares `comparisonDefinition` objects, empty vs. stored-entity looks "unchanged" — no annotations appear.

This affects the common first-import workflow: components exist on the server (pushed in a prior session), the user re-extracts, opens the editor, and expects to see how edits compare against what's deployed. Without CDF data in the current session, the preview is blind to prop-level changes.

### Observable symptoms

- Removing a prop produces no "breaking" annotation
- All annotations remain frozen or empty
- On second entry to the editor (after generate runs), annotations are correct
- The `comparisonDefinition` sent to the server has empty `contentProperties` / `designProperties` arrays

## Decision

Two complementary changes:

### Preserve CDF columns across editor saves (`preserveCDF`)

Add a `preserveCDF` option to `storeRawComponents`. When enabled, the function snapshots existing CDF classification data before the DELETE and restores it for props that still exist after re-insert. Only props where the UPDATE actually matched (i.e., the prop still exists) get their allowed values restored — preventing FK constraint violations for renamed/removed props.

**Matching logic**: `(component_id, prop_name)` identity. `component_id` is deterministic: `sha256(name + ":" + source).slice(0, 12)`.

**Scope**: Only the editor's Ctrl+S path uses `preserveCDF: true`.

### Raw prop fallback in `loadCDFComponents`

When a generated component has zero CDF-classified props, `loadCDFComponents` now falls back to loading raw props and synthesizing minimal CDF entries:
- `$category` comes from the raw `category` column (default: `'content'`)
- `$type` is inferred via a simple mapping: `boolean` → `boolean`, `number` → `number`, union/enum types → `enum`, everything else → `string`
- `$required`, `$default`, `$description` carried from raw columns

This ensures the manifest always includes prop names and categories, which is all the server's `createProposedComponentComparisonDefinition` needs to build a meaningful diff.

**Why this is safe**: The fallback only applies when CDF data is entirely absent. Once `generate` runs and populates CDF columns, the fallback is never triggered for that component. The synthesized types may differ from what the LLM would produce, but they're consistent within a session — the preview shows correct add/remove signals even if type annotations are approximate.

### Combined behavior

| Scenario | `preserveCDF` | Raw fallback | Result |
|----------|---------------|--------------|--------|
| Prior generate exists, user edits | Preserves CDF through saves | Not triggered (CDF exists) | Accurate annotations |
| No prior generate, user removes prop | N/A (nothing to preserve) | Provides prop names to manifest | Server detects removal as breaking |
| No prior generate, user adds prop | N/A | New prop visible immediately via raw data | Server detects new prop |
| No prior generate, user renames prop | N/A | Old name disappears, new name appears | Server detects removal + addition |

## Alternatives Considered

### A: Full local CDF synthesis on every save

Build a complete deterministic mapping and populate CDF columns during save.

Rejected because:
- Would produce different classifications than the LLM, causing confusing annotation flips between editor and post-generate states
- Adds a parallel classification system that drifts from the real one
- The raw fallback approach is lighter — it only synthesizes at read time, never writes synthesized data to the DB

### B: Build manifest directly from in-memory editor state

Skip the DB roundtrip entirely.

Rejected because:
- Still requires CDF synthesis (raw props aren't in CDF format)
- Duplicates manifest-building logic
- Breaks the clean separation between editor state and DB state

### C: Re-run LLM classification on each save

Rejected because:
- Too slow for interactive feedback (5-30s per classification)
- Wasteful API calls for minor edits
- Overkill for the problem

## What this does NOT solve

- **`required: false → true` detection**: The server-side change classifier does NOT detect this as breaking (it only flags prop removal, type change, validation narrowing, and required-without-default on new props). This is a separate gap in the preview backend's change-classifier.
- **Type-level diff accuracy without generate**: The raw fallback synthesizes approximate types. If a prop's raw type is `'primary' | 'secondary'` and the stored entity has type `enum`, the comparison works (prop name is present). But if the user changes the raw type and expects a "type changed" annotation, it won't fire until after `generate` produces accurate CDF types.

## Consequences

- Preview annotations now update in real-time when users edit props in the analyze-select editor — both with and without a prior generate run
- The `storeRawComponents` function gains `preserveCDF` option; default behavior unchanged
- `loadCDFComponents` now returns props for all generated components (using raw fallback when CDF is absent)
- No new external dependencies or API changes
- Test coverage added for: preservation across saves, FK safety on prop removal/rename, raw fallback synthesis, and default behavior unchanged

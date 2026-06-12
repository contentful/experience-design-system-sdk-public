# ADR: Annotate Data-Fetch Wrappers Instead Of Treating Them As Authoring Components

## Status

Accepted

## Context

Some host repositories split a logical component into two files:

- a renderer that defines the author-facing UI surface
- a data-fetch wrapper that loads data and forwards it into the renderer

The marketing starter template is a concrete example of this pattern (`CtfHeroBanner` vs `CtfHeroGql`). If both survive extraction and selection, the pipeline may generate CDF from infrastructure props such as `id`, `locale`, and `preview` instead of the real authoring props exposed by the renderer.

The previous extractor filter also dropped every zero-prop / zero-slot component. That was too aggressive for components that still render real compositional UI, such as page-level renderers whose props were not surfaced by extraction.

## Decision

1. `analyze extract` remains deterministic and keeps uncertain components in the session DB.
2. A deterministic source-inspection pass annotates likely data-fetch wrappers using `reviewReasons`, `needsReview`, and adjusted extraction confidence.
3. Zero-prop / zero-slot components are no longer dropped blindly when their source clearly renders visible or compositional UI; they are retained and flagged for review.
4. `analyze select-agent` receives the extractor's review signals plus a bounded, deterministic selection-context bundle assembled from the customer-provided project root: the component source, sibling files, import/export summary, resolver references, and one likely parent usage site.
5. `analyze select-agent` uses one pass for clean components and five-pass consensus only for components already flagged for review or scored at confidence `<= 3`; a `3-2` split remains `needs-review`.
6. `generate components` continues to trust the resolved selection state; selection remains the source of truth for what is generated.

## Consequences

- The pipeline keeps more borderline candidates for audit instead of silently dropping them.
- Wrapper-heavy repos are less likely to generate author-facing schema from infrastructure-only props.
- Manual and agentic selection both rely on the same deterministic review signals, and agentic selection now gets bounded structural repo context instead of free-form repo traversal.
- Generation remains aligned with the operator or agent review decision instead of applying a second hidden filter.

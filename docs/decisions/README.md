# Decision Records

This directory holds architecture decisions that shape this SDK package: the entity reference format, the TUI import/review flow, and the composite-vs-atomic component graph model.

## Curation note

This package has a larger internal set of decision records. Only decisions still in force and relevant to this package's public surface are included here — records that were superseded, or that describe internal service/authorization architecture outside this package's scope, are intentionally excluded. Internal ticket numbers, reviewer names, and Slack references have been stripped or generalized for a public audience; the technical content is unchanged.

## How to use this directory

- Read the ADR that matches the concern before changing a major boundary.
- Add a new ADR when a change affects the entity reference model, the TUI review flow, or the composite/atomic graph policies.

## Current ADR set

1. [ADR 0001: Ship DesignToken/ComponentType `source` field with Link, migrate to ResourceLink later](0001-design-token-source-link-vs-resourcelink.md)
2. [ADR 0002: Real-Time Preview Feedback in Analyze-Select Editor](0002-tui-analyze-select-real-time-preview.md)
3. [ADR 0003: DSI TUI — ScopeGate and GenerateReview graph policies](0003-tui-scope-gate-vs-generate-review-graph-policies.md)

## ADR expectations for future changes

- Keep the decision statement crisp.
- Capture the tradeoff, not just the implementation.
- No internal ticket links, reviewer names, or Slack channel references — this repo is public.

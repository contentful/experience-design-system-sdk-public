# CDF is the manifest

## Status

Accepted

## Context

The CLI and SDK previously modeled component definitions and design tokens as
two separate documents (`componentsManifest` / `tokensManifest`) wrapped in a
shared envelope. This added an indirection layer with no independent value:
every consumer needed both documents together, and the envelope existed only
to hold them.

## Decision

The CDF (Component Definition Format) document is now the single manifest.
Component entries and DTCG design token entries live side by side in one
recursive document, discriminated per-entry by `$type` (`'component'` vs. a
`DESIGN_TOKEN_TYPES` member). The two-key envelope is removed from the SDK
types package, the CLI, and the EDSI server.

## Consequences

- One document format to parse, validate, and pass between CLI, SDK, and
  server — no envelope reconciliation.
- The term "manifest" is retained only where it names a genuine external wire
  contract (e.g. the `manifest:components/...` error-path prefix); everywhere
  else it is replaced by "CDF document."

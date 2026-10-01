# Extraction model, controller, service, and adapter boundaries

## Status

Accepted

## Date

2026-10-01

## Context

The extraction package began as a collection of framework-specific files and
pipeline helpers. That shape made it difficult to identify the public contract,
to keep framework behavior isolated, and to distinguish extraction evidence
from the authorable component model. The import workflow also needs a stable
in-process boundary that can be called without coupling the extraction library
to CLI processes, filesystem scanning, or session persistence.

## Decision

The extraction package uses the following boundaries:

- Models under `src/extract/model` contain data and contract types only.
- `extractEndpoint` under `src/extract/controller` is the public controller
  contract and owns request validation and progress translation.
- Services under `src/extract/services` own orchestration, adapter routing and
  execution, deduplication, classification, and extraction-time quality policy.
- Evidence under `src/extract/evidence` records source and structural signals
  separately from authorable component output.
- Framework adapters under `src/extract/adapters` implement the
  `ComponentExtractor` port and own framework-specific syntax handling.
- The package root is the supported consumer surface; internal source paths are
  not public API.

The extraction package remains an in-process library. It does not introduce a
generic dependency-injection framework, an HTTP transport, or an intermediate
JSON handoff. The CLI owns directory scanning, composition resolution,
filesystem and SQLite persistence, generation, and TUI concerns.

## Consequences

- Callers can use a typed extraction endpoint without spawning a hidden CLI
  command or parsing process output.
- Framework-specific changes remain behind the extractor port and registry.
- Evidence can be preserved for review without promoting lower-trust signals to
  authorable component contracts.
- Existing root exports, including the pipeline API, supported adapters, and
  policy helpers, remain available to repository consumers.
- New consumers should import from the extraction package root rather than
  reaching into `src/extract` implementation paths.

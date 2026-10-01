# Extraction package ownership boundaries

## Status

Accepted

## Date

2026-10-01

## Context

The extraction package accumulated framework adapters, file-processing helpers,
resolution logic, evidence functions, quality rules, and compatibility
re-exports in one broad source area. That layout made ownership unclear and
encouraged consumers to depend on implementation paths rather than the typed
package contract.

## Decision

Organize extraction by responsibility:

- `model/` owns typed extraction data and endpoint contracts.
- `controller/` owns public request validation and progress mapping.
- `services/` owns orchestration, classification, quality composition, and adapter registration.
- `policies/quality/` owns deterministic authorability, scoring, source inspection, and validation rules.
- `evidence/` owns reusable source, slot, and structural evidence.
- `adapters/<framework>/` owns framework syntax and extraction behavior.
- `adapters/support/` owns shared adapter file processing, resolution, source locations, and TSX mechanics.

The package root exports supported APIs from their canonical implementations.
Compatibility-only re-export files are removed once a repository-wide consumer
audit confirms that no caller imports them directly. Adapter-local provisional
scoring remains supported where a public adapter consumer observes it; moving
final score ownership to the quality service requires an explicit contract
change and characterization coverage.

## Consequences

- New shared adapter mechanics have one clear home under `adapters/support/`.
- Quality policy changes are isolated from framework syntax and orchestration.
- Public callers continue using package-root exports while implementation paths remain internal.
- Repository-wide consumer audits are required before removing compatibility modules.

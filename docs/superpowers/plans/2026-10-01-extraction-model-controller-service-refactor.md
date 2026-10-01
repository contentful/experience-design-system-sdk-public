# Extraction model-controller-service refactor

Status: Phase 6 complete; Phase 7 pending

Baseline: `e2fbe38f6505fc2525dc090740ea63db89bb6b61`

Scope: `@contentful/experience-design-system-extraction`, its extraction-facing
CLI tests, public exports, and repository architecture documentation.

Scope classification: large single-repository refactor with seven independently
verifiable workstreams and a high-risk public API preservation boundary.

## Objective

Reorganize the extraction package around explicit model, controller, service,
adapter, evidence, and infrastructure boundaries without changing extraction
behavior or the public package contract.

The package is a library, not an HTTP application. The controller is the
in-process public entrypoint, the services own extraction policy and
orchestration, framework adapters implement the extractor port, and the CLI/TUI
remains outside the package as the consuming view/transport layer.

## Current-state findings

- `src/extract` contains 23 files and approximately 9,169 lines.
- `endpoint.ts` validates the request, runs the pipeline, pre-classifies props,
  inspects source, applies non-authorable policy, scores components, and
  validates output.
- `pipeline.ts` combines framework routing, parallel execution, progress
  aggregation, component identity, duplicate resolution, and path heuristics.
- `react.ts`, `svelte.ts`, and `web-components.ts` are large framework adapters
  that each combine AST setup, type resolution, prop extraction, slot
  extraction, normalization, and result assembly.
- `src/index.ts` exports both the stable endpoint and many lower-level helpers;
  the first refactor must preserve those root-level exports.
- Framework behavior is primarily covered by
  `packages/experience-design-system-cli/test/analyze/extract/`, while the
  package currently has focused endpoint tests in `test/endpoint.test.ts`.

### Baseline root-export classification

| Classification | Symbols at the baseline | Phase 1 decision |
| --- | --- | --- |
| Public contract | `extractEndpoint`, endpoint request/response/progress types, `RawComponentDefinition`, `RawPropDefinition`, `RawSlotDefinition`, `ComponentExtractionResult`, `ExtractorProgress`, `ExtractorOptions`, validation issue types, and `ComponentExtractor` | Preserve names and root-level type visibility. |
| Supported extraction APIs | `extractComponents`, all seven framework extractors, and `stripScoringFields` | Preserve as supported package entrypoints while moving implementation files. |
| Supported policy/evidence APIs | Pre-classification, scoring, source inspection, non-authorable filtering, validation, slot detection, and allowed-component helpers | Preserve behavior and root exports until a downstream-consumer census is complete. |
| Compatibility/helper exports | `parseImportedNames`, review-reason formatters, review-reason constants, and related helper predicates | Do not remove during this refactor; reassess only in the final export-cleanup phase. |

## Target dependency shape

```text
public package entrypoint
        |
        v
extract controller
        |
        v
extraction service -----> policy/evidence services
        |
        v
extractor port
        |
        v
framework adapters -----> AST/filesystem infrastructure
        |
        v
domain models
```

Dependency rules:

- Models contain data and contract types and do not import `ts-morph`, Node
  filesystem APIs, framework parsers, or CLI modules.
- The controller validates and translates the public request, delegates the
  use case, and maps progress; it does not contain extraction policy.
- Services depend on extractor ports and models rather than concrete framework
  modules.
- Framework adapters return package models and may use AST infrastructure;
  they do not know about the public controller or CLI persistence.
- Infrastructure owns filesystem, AST, module-resolution, and concurrency
  mechanics and is not exported as part of the primary public API.

## Target layout

```text
packages/experience-design-system-extraction/src/extract/
  model/
    component.ts              # Raw component, prop, slot, and diagnostics types
    contract.ts                # Endpoint request, response, and progress types
    scoring.ts                 # Score and review metadata types
  controller/
    extract-controller.ts      # Public extractEndpoint implementation
  services/
    extraction-service.ts      # End-to-end extraction use case
    extractor-registry.ts      # File routing and framework adapter registration
    extraction-runner.ts       # Parallel execution and progress aggregation
    component-deduplicator.ts  # Identity, family, and duplicate policy
    classification-service.ts  # Deterministic pre-classification
    quality-service.ts         # Inspection, authorability, scoring, validation
  evidence/
    slot-evidence.ts           # Declared and allowed-component slot evidence
    structural-slot-evidence.ts
    source-evidence.ts         # Source inspection and imported-name evidence
  adapters/
    react/
    vue/
    astro/
    svelte/
    stencil/
    web-components/
  infrastructure/
    ast/                       # ts-morph project and type-resolution helpers
    filesystem/                # file workers, source metadata, local modules
    concurrency/
```

The initial move should preserve cohesive files where possible. Splitting the
large framework adapters into `props`, `slots`, `dataflow`, and `normalization`
modules is a second step after their boundaries are visible and covered.

## Ordered implementation plan

### 1. Freeze the contract and add characterization coverage — complete

- [x] Record the current root exports from `src/index.ts` and classify each as
  public contract, supported adapter API, or internal helper.
- [x] Expand endpoint tests to cover request validation, progress completion,
  warning preservation, pre-classification, scoring, non-authorable review
  signals, and validation output.
- [x] Add characterization assertions for extractor routing and result
  ordering, duplicate resolution, progress totals, and unsupported-file
  handling that must survive file moves.
- [x] Capture the React DOM attribute surface invariants, including bounded
  prop counts, before moving the React adapter.

Verification completed: extraction package tests passed with 3 files and 10
tests; CLI extraction tests passed with 23 files and 334 tests, followed by the
React suite at 70 tests after the DOM-surface guard was added; extraction
typecheck and lint passed.

### 2. Establish model and port boundaries — complete

- [x] Move `types.ts` into model modules without changing the root-level type
  exports or serialized `RawComponentDefinition` shape.
- [x] Move endpoint request, response, and progress types into the model
  contract module.
- [x] Move `ComponentExtractor` into a service port module and keep its
  `ExtractorOptions` and progress semantics unchanged.
- [x] Keep scoring and review metadata typed separately from extraction policy.
- [x] Update internal imports first, then confirm consumers still import from
  `@contentful/experience-design-system-extraction`.

Verification completed: the model-boundary test passed with 2 tests; extraction
tests passed with 4 files and 12 tests; extraction typecheck and lint passed;
the CLI extraction suite passed with 23 files and 334 tests; and CLI typecheck
passed. Root-level exports and runtime payload shapes remain compatible.

### 3. Split the controller from the extraction service

- [x] Rename `endpoint.ts` to the controller location while retaining the
  public function name `extractEndpoint`.
- [x] Extract request validation and public progress mapping into the
  controller/contract boundary.
- [x] Move the extraction use case into `ExtractionService`, preserving the
  exact order: extraction, pre-classification, source inspection,
  non-authorable policy, scoring, and validation.
- [x] Preserve the endpoint guarantees that it does not scan directories,
  invoke agents, or persist sessions.

Verification completed: the controller boundary tests cover request validation,
service delegation, and progress translation; the service integration test
covers scored and validated output with explicit file paths and no CLI/session
dependencies; extraction package tests passed with 5 files and 15 tests;
extraction typecheck and lint passed.

### 4. Decompose the pipeline service

- [x] Extract the framework registry and file-filter routing from `pipeline.ts`.
- [x] Extract parallel adapter execution and progress aggregation into a runner.
- [x] Extract family detection, identity keys, preferred-path selection, and
  duplicate warnings into a deduplication service.
- [x] Keep extractor registration order, concurrent execution behavior, warning
  text, and duplicate selection semantics unchanged.
- [x] Keep the service API small: one extraction use case plus explicit internal
  ports rather than a generic dependency-injection container.

Verification completed: focused pipeline-service tests cover routing, progress
aggregation, empty-file groups, duplicate selection, and cross-package
collisions; the extraction package passed 6 test files and 19 tests, typecheck,
and lint; the CLI extraction suite passed 23 files and 334 tests; and the CLI
typecheck and extraction-test lint passed without invoking generated-client
codegen.

### 5. Isolate classification, quality, and evidence policies

- [x] Move `pre-classify.ts` behind a classification service while preserving
  exclusion rules and the `domAttribute` provenance removal boundary.
- [x] Group `non-authorable-filter.ts`, `source-inspection.ts`, `scoring.ts`,
  and `validate.ts` behind an explicit quality service.
- [x] Group slot detection, allowed-component parsing, structural slot evidence,
  and imported-name parsing under evidence modules.
- [x] Keep evidence provenance distinct from generated authorable props and
  slots.
- [x] Add unit tests for each service's positive and negative policy outcomes,
  especially retained-for-review versus excluded components.

Verification completed: classification and quality boundary tests cover positive
and negative policy outcomes; evidence boundary tests cover slot, declared
allowed-component, and imported-name evidence; the extraction package passed 8
test files and 26 tests, typecheck, and lint; the CLI extraction suite passed 23
files and 334 tests; and CLI typecheck and extraction-test lint passed.

### 6. Reorganize framework adapters

- [x] Move each framework extractor into its adapter directory with no behavior
  changes: React, Vue, Vue TSX, Astro, Svelte, Stencil, and Web Components.
- [x] Move shared TSX utilities to the adapter-support/infrastructure boundary
  and make the dependency explicit for React, Stencil, and Web Components.
- [x] Split only the largest adapters after relocation, using cohesive seams
  for props, slots, dataflow/type resolution, and result normalization.
- [x] Preserve framework-specific sharp edges: React DOM prop allowlists,
  Svelte unresolved-type retry behavior, Vue inherited-prop resolution,
  Stencil decorator handling, and Web Component Lit metadata filtering.

Verification completed: the adapter boundary characterization test passes; the
extraction package passes 9 test files and 32 tests, typecheck, and lint; and
the complete CLI extraction suite passes 23 files and 334 tests. The CLI
typecheck remains gated by the environment's `tsx` IPC `listen EPERM` during
unrelated generated-client codegen.

### 7. Stabilize exports, documentation, and cleanup

- [x] Update `src/index.ts` to export the stable controller contract, models,
  supported adapter entrypoints, and policy helpers intentionally.
- [x] Remove only accidental internal exports after checking repository-wide
  consumers; retain compatibility re-exports when a supported consumer exists.
- [x] Update `AGENTS.md`, `ARCHITECTURE.md`, and `CONTRIBUTING.md` paths and
  diagrams to describe the new package boundaries.
- [x] Add a short architecture decision record if the new dependency rules are
  intended to remain a long-term package invariant.
- [x] Remove empty compatibility files and stale path references only after all
  tests and generated declarations pass.

Verification: the extraction package build, typecheck, lint, and tests pass;
the CLI extraction suite passes 23 files and 334 tests; and scoped `rg` finds no
stale extraction-package `src/analyze/extract` references.

## Commit strategy

1. `test(extraction): characterize extraction contracts and policies`
2. `refactor(extraction): separate models, ports, and controller`
3. `refactor(extraction): decompose the extraction pipeline services`
4. `refactor(extraction): organize extraction evidence and framework adapters`
5. `docs(extraction): document model controller service boundaries`

Each commit should build and pass the narrowest relevant tests, and no commit
should mix behavioral fixes with directory-only moves.

## Completion criteria

- `extractEndpoint` remains the stable in-process public contract.
- `RawComponentDefinition`, progress, warnings, scoring, and validation shapes
  are unchanged unless a separate API decision is approved.
- The controller has no filesystem scanning, agent invocation, or persistence.
- Framework-specific code is isolated behind the extractor port.
- Pipeline routing, concurrency, deduplication, classification, evidence,
  scoring, and validation each have an identifiable owner.
- All existing extraction and CLI regression tests pass.
- The package architecture documentation matches the checked-in directory
  structure.

## Risks and stop conditions

- Stop before changing public exports if a downstream consumer imports an
  internal source path or depends on declaration output beyond the package root.
- Stop before splitting a framework adapter if characterization coverage cannot
  distinguish a structural move from a behavior change.
- Stop and update this plan if a service boundary requires cross-package changes
  to CLI session persistence, generation, or apply behavior.
- Do not introduce a generic DI framework, HTTP transport, or new intermediate
  JSON representation as part of this refactor.

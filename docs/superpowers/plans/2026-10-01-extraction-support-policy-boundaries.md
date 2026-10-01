# Extraction support and quality policy boundaries

research_started_at: 2026-10-01T14:49
status: phase-5-complete
base_commit: 964f09c2ffb4d300a782ce38b88e0781a766c60b
branch: codex/extraction-support-policy-organization

## Objective

Complete the extraction package organization that began with the model,
controller, service, evidence, and adapter split. The remaining top-level
helpers should have explicit ownership without creating a generic `utils/`
bucket or changing the package-root API.

## Scope

This plan covers the remaining files under
`packages/experience-design-system-extraction/src/extract/` at the base commit:

- `pipeline.ts`
- `file-extraction-workers.ts`
- `resolve-local-module.ts`
- `resolve-type-property.ts`
- `source-line-metadata.ts`
- `scoring.ts`
- `source-inspection.ts`
- `non-authorable-filter.ts`
- `validate.ts`
- `slot-detection.ts`
- Compatibility re-exports: `src/pre-classify.ts`,
  `src/extract/parse-imported-names.ts`, `src/extract/slot-allowed-components.ts`,
  and `src/extract/structural-slot-evidence.ts`

The existing model, controller, evidence, service, and framework-adapter
boundaries remain intact. No HTTP transport, dependency-injection framework,
intermediate JSON handoff, CLI filesystem scan, or session-persistence logic is
introduced.

## Invariants

- The package-root exports in `src/index.ts` retain their current names and
  runtime behavior.
- `extractEndpoint` remains the stable in-process controller contract.
- `extractComponents` remains available as the low-level pipeline API.
- Framework adapters remain responsible for framework syntax and adapter-local
  extraction evidence, not directory scanning or session persistence.
- The extraction service remains the owner of final classification, quality,
  authorability, scoring, review, and validation policy for endpoint calls.
- Every relocation is behavior-preserving unless a separate test documents an
  approved policy correction.

## Target layout

```text
src/extract/
  controller/
  model/
  evidence/
  policies/
    quality/
      authorability.ts
      scoring.ts
      source-inspection.ts
      validation.ts
  services/
    extraction-pipeline.ts
    extraction-service.ts
    extraction-runner.ts
    extractor-registry.ts
    component-deduplicator.ts
    classification-service.ts
    quality-service.ts
    ports/
  adapters/
    <framework>/
    support/
      tsx-shared.ts
      file-processing/
        file-workers.ts
        project-source-files.ts
        result-normalizer.ts
      resolution/
        local-module.ts
        type-property.ts
        source-location.ts
```

Dependency direction:

```text
controller → services → adapters → adapter support
                  ├──→ policies/quality
                  ├──→ evidence
                  └──→ model
```

Adapters may consume model types, evidence helpers, and adapter support. They
must not import the controller or persistence-aware CLI code. Quality policies
are deterministic package-local rules; services compose them and own the
pipeline-level decision.

## Phase 1: Characterize remaining boundaries

- [x] Add focused extraction-package tests for the generic file worker contract:
  per-file warning capture, progress accounting, result callbacks, bounded
  concurrency, and stable result normalization.
- [x] Add focused tests for project-source iteration, local-module resolution,
  type-property resolution, and source-line metadata extraction.
- [x] Extend policy characterization coverage for authorability, scoring,
  source inspection, validation, and the Svelte unresolved-type retry path.
- [x] Preserve the existing public-export test and add assertions that moved
  helpers remain internal implementation modules.
- [x] Run the focused tests before implementation and record the expected red
  state for any new boundary test, then make each test green immediately after
  its corresponding move.

Verification:

```sh
pnpm -F @contentful/experience-design-system-extraction test
pnpm exec vitest run test/analyze/extract
```

## Phase 2: Move and split adapter support infrastructure

- [x] Move `file-extraction-workers.ts` into adapter support and split its three
  responsibilities into file workers, ts-morph project-source iteration, and
  result normalization.
- [x] Move `resolve-local-module.ts` to the adapter-support resolution area as
  `local-module.ts`.
- [x] Move `resolve-type-property.ts` to the adapter-support resolution area as
  `type-property.ts`.
- [x] Move `source-line-metadata.ts` to the adapter-support resolution area as
  `source-location.ts`.
- [x] Update every adapter import and preserve warning, ordering, progress,
  JavaScript fallback, required-property, and source-line behavior.
- [x] Keep `tsx-shared.ts` alongside these helpers as the adapter-support
  boundary; do not create a package-wide miscellaneous utility directory.

Verification:

```sh
pnpm -F @contentful/experience-design-system-extraction typecheck
pnpm -F @contentful/experience-design-system-extraction test
pnpm exec vitest run test/analyze/extract
```

## Phase 3: Move the pipeline facade into services

- [x] Move `pipeline.ts` to `services/extraction-pipeline.ts`.
- [x] Preserve the `extractComponents` signature, adapter routing order,
  concurrent execution, deduplication, hook filtering, warnings, and progress.
- [x] Keep the package-root `extractComponents` export stable while changing
  only its internal source path.
- [x] Update service and test imports to make the pipeline service the explicit
  owner of adapter composition.

Verification:

```sh
pnpm -F @contentful/experience-design-system-extraction test
pnpm exec vitest run test/analyze/extract/pipeline.test.ts test/analyze/extract/parallel-extraction.test.ts
```

## Phase 4: Isolate quality policies

- [x] Move `non-authorable-filter.ts` to
  `policies/quality/authorability.ts`.
- [x] Move the scoring algorithm in `scoring.ts` to
  `policies/quality/scoring.ts`; keep the score data shapes in
  `model/scoring.ts`.
- [x] Move `source-inspection.ts` to
  `policies/quality/source-inspection.ts`.
- [x] Move `validate.ts` to `policies/quality/validation.ts`.
- [x] Update `quality-service.ts` and root exports without changing the public
  helper names.
- [x] Characterize the Svelte adapter's direct scoring consumers through the
  public adapter and CLI Svelte coverage; preserve its adapter-local
  provisional score because those consumers observe `extractionConfidence`,
  `reviewReasons`, and `needsReview` before endpoint-level quality evaluation.
- [x] Preserve the adapter-local provisional score pending an explicit public
  contract change that moves final confidence ownership to `quality-service`.

Verification:

```sh
pnpm -F @contentful/experience-design-system-extraction test
pnpm exec vitest run test/analyze/extract/scoring.test.ts test/analyze/extract/source-inspection.test.ts test/analyze/extract/validate.test.ts test/analyze/extract/non-authorable-filter.test.ts test/analyze/extract/svelte.test.ts
```

## Phase 5: Remove stale compatibility files and document ownership

- [x] Confirm repository-wide consumers before deleting
  `pre-classify.ts`, `parse-imported-names.ts`, `slot-allowed-components.ts`,
  and `structural-slot-evidence.ts`.
- [x] Delete `slot-detection.ts` after the repository-wide audit confirmed it is
  only a compatibility re-export.
- [x] Update `src/index.ts` to import canonical implementations directly while
  retaining all supported root exports.
- [x] Update `AGENTS.md`, `ARCHITECTURE.md`, and `CONTRIBUTING.md` to describe
  policy and adapter-support ownership and remove stale source paths.
- [x] Add an ADR documenting the final service, policy, evidence, and adapter
  support dependency rules.

Verification:

```sh
rg -n 'src/(pre-classify|extract/(pipeline|file-extraction-workers|resolve-local-module|resolve-type-property|source-line-metadata|scoring|source-inspection|non-authorable-filter|validate|slot-detection))' packages docs AGENTS.md ARCHITECTURE.md CONTRIBUTING.md
pnpm -F @contentful/experience-design-system-extraction build
pnpm -F @contentful/experience-design-system-extraction typecheck
pnpm -F @contentful/experience-design-system-extraction lint
pnpm -F @contentful/experience-design-system-extraction test
pnpm exec vitest run test/analyze/extract
```

The stale-path search should return no implementation references; legitimate
fixture paths and historical plan text must be excluded or called out rather
than treated as source consumers.

## Commit strategy

1. `test(extraction): characterize support and quality boundaries`
2. `refactor(extraction): organize adapter support infrastructure`
3. `refactor(extraction): move the extraction pipeline facade`
4. `refactor(extraction): isolate extraction quality policies`
5. `refactor(extraction): remove stale extraction compatibility wrappers`

Each commit should remain buildable, preserve the root export surface, and use
red-green testing for the behavior it relocates.

## Stop conditions

- Stop before deleting a wrapper if a repository consumer imports it directly.
- Stop before changing Svelte scoring if direct adapter behavior is covered by a
  supported consumer and no compatibility decision exists.
- Stop if a helper is consumed outside adapters or extraction services; update
  this layout rather than forcing it into adapter support.
- Stop if a move changes warning text, progress counts, component ordering,
  review reasons, or validation output without a characterization test and an
  explicit policy decision.

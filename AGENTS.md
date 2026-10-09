# Agent Guide

This file tells AI coding agents what they need to know to be productive in this repo. Read it before making changes.

## Repo at a Glance

Nx monorepo with six packages:

- `packages/experience-design-system-cli` — the published CLI (`@contentful/experience-design-system-cli`, bins `experiences`, `exo`, `experience-design-system-cli`). An Ink TUI; `experiences import` and bare `experiences` open it. It forwards `apply`, `setup`, `doctor`, `print`, `map` and `__*` to the bundled legacy CLI
- `packages/experience-design-system-cli-legacy` — the previous CLI and import wizard (`@contentful/experience-design-system-cli-legacy`). Private and never published; its build output is copied into `packages/experience-design-system-cli/legacy/` and spawned from there. It is being ported into the new CLI and will then be deleted
- `packages/experience-design-system-extraction` — component extraction engine (ts-morph, framework parsers); a runtime dependency of the CLI
- `packages/experience-design-system-generation` — agent-invocation and skill-prompt engine; used internally by the import wizard
- `packages/experience-design-system-client` — generated API client for the Experience Design System Integrations API (from `openapi.json` via `@hey-api/openapi-ts`); a runtime dependency of the CLI's `apply` command
- `packages/experience-design-system-types` — shared types, schemas, validation

The CLI extracts React/Vue/Astro/Stencil/Web Component definitions from customer codebases using the TypeScript compiler API (ts-morph), invokes a coding agent to produce CDF artifacts, validates them against JSON schemas, and provides interactive terminal UIs (Ink) for reviewing, finalizing, and pushing them to Contentful ExO.

The supported import pipeline is internal to `experiences import`: **extract → selection agent → internal generation → validate → apply.** When a raw token source is supplied (the token-input screen), the wizard performs token generation internally before component extraction and generation, then runs token mapping after generation. The extraction and selection stages are implementation modules, not public commands.

Unless stated otherwise, `src/...` paths below are relative to `packages/experience-design-system-cli-legacy`.

Legacy commands: `import`, `apply <file>`, `setup`, `doctor`, `build`. Hidden internal commands the wizard spawns: `__extract`, `__generate`, `map tokens`, `print`. The former `runs`, `session` and `analyze` commands no longer exist.

### Wizard step machine (`packages/experience-design-system-cli-legacy/src/import/tui/`)

```
extracting (selection agent runs here)
        → scope-gate → generating → final-review → path-prompt
        → previewing → preview-gate → pushing → done
```

The Welcome, Token input, Path validation and Credentials screens live in the new CLI (`packages/experience-design-system-cli/src/tui/import/steps/`), which validates and saves the credentials before it spawns the legacy wizard. The wizard starts straight at `extracting` and receives the project path and token file from the new CLI; choosing skip on the Credentials screen sets `EDS_IMPORT_SKIP_CREDENTIALS=1`, which saves files only. Choosing `[s]` on `credentials` saves files only: the preview is bypassed and push is refused.

A single human review gate (`scope-gate`) precedes generation. The final-review step edits names, `$description`, `$default`, `$allowedComponents` and `$values` inline, with source and rationale panels. After final-review the wizard always saves one combined `components.json` CDF and, unless credentials were skipped, previews and pushes it.

### Run records

Each successful wizard run appends a record to `~/.contentful/experience-design-system-cli/state/runs.json`. There is no command for listing them.

### Import options

The public `experiences import` takes no flags and opens the TUI. The bundled legacy wizard, which the TUI spawns after the first three screens, accepts `--project`, `--tokens`, `--agent`, `--prompt <stage=value>` and `--no-cache`. `--model`, `--composition-map`, `--skip-map-tokens` and `--raw-tokens` were removed and are rejected. The model is passed as `--agent agent:model`; it resolves `--agent` → `credentials.json` → built-in default, and `EDS_AGENT_MODEL_<AGENT>` sets a per-agent model.

## Build System

This repo uses **Nx** for task orchestration. Do not run `tsc` directly — always go through Nx:

```bash
pnpm build          # build all packages
pnpm test           # test all packages
pnpm lint           # lint all packages

# Single package (preferred when iterating)
pnpm -F @contentful/experience-design-system-cli build            # the published CLI (also builds legacy and copies it in)
pnpm -F @contentful/experience-design-system-cli-legacy test
pnpm -F @contentful/experience-design-system-cli-legacy typecheck
```

The legacy CLI's compiled output lands in `packages/experience-design-system-cli-legacy/dist/src/`, not `dist/`. This is because `@nx/js:tsc` preserves the `src/` prefix. If you see Nx cache issues after structural changes, run:

```bash
pnpm -F @contentful/experience-design-system-cli-legacy clean && pnpm build
```

## TypeScript

- All packages use `"type": "module"` — ESM only. Use `.js` extensions in import paths even when the source is `.ts`.
- `tsconfig.json` has `"jsx": "react-jsx"` — Ink components work without any extra config.
- Ink 5 is ESM-only. Do not add `require()` calls.
- `typescript` is a **runtime** dependency of the CLI (it compiles customer code at analysis time).

## Pipeline Session Database

All intermediary data between commands flows through a SQLite session database — there are no intermediary JSON files. The database is at `~/.contentful/experience-design-system-cli/pipeline.db` and is accessed via Node's built-in `DatabaseSync` (not `better-sqlite3`).

The session layer lives in `src/session/db.ts`:

- `openPipelineDb(path?)` — opens (and initializes) the DB; uses `EDS_PIPELINE_DB_PATH` env or the default path
- `getOrCreateSession(db, sessionFlag, name, hints)` — creates or resumes a session
- `createStep(db, sessionId, command, inputs)` — creates a step, marking any prior pending step as interrupted
- `updateStep(db, stepId, status, outputs, error?)` — marks a step complete or failed
- `storeRawComponents(db, sessionId, components)` — idempotent DELETE+INSERT; replaces all raw components for the session
- `loadRawComponents(db, sessionId)` — returns `RawComponentDefinition[]` from the session

The standalone `map tokens` stage (`src/map-tokens/`) runs after generated CDF and DTCG data are in the session and before artifacts are printed or applied. It deterministically resolves a canonical DTCG path, or a unique token-kind-compatible normalized terminal member, from `tokenReference` when present and otherwise from the extracted default. It preserves the extracted default in `raw_props`; unresolved or ambiguous matches remain unchanged and produce diagnostics. It then optionally invokes the coding agent to infer `$token.allowed` paths for design-category token properties. `--skip-agent` skips only that agentic inference; deterministic default resolution still runs.

The session stores the default projection in the `raw_token_name_paths` sidecar (`raw_name`, canonical DTCG `path`, and `source` of `automatic` or `manual`). `raw_prop_token_paths` stores ordered token-path lists per component property and records whether a list is an agent suggestion or a review decision. CDF loading projects a compatible resolved path into `$default` while retaining the raw extracted default when no valid resolution exists; only non-empty allowed lists are projected as `$token.allowed`.

**Do not write intermediary JSON files for extracted component data.** The handoff from extraction to internal generation flows through the session DB. The explicit `tokens.json` produced by optional token preparation is a separate input sidecar for component generation or apply.

**`DatabaseSync` synchronous write invariant:** all multi-statement operations use explicit `BEGIN`/`COMMIT`/`ROLLBACK`. SIGINT and crash cannot produce partially-written state. Do not add async alternatives to this path.

In tests, set `EDS_PIPELINE_DB_PATH` to a temp path to avoid polluting the developer's real DB.

## The React Extractor

`packages/experience-design-system-extraction/src/extract/react.ts` is the most complex file (~2500 lines). Before editing it:

1. Understand the DOM attribute prop surfacing strategy — see "DOM attribute prop surfacing" in `ARCHITECTURE.md`
2. Understand how SVGProps is handled — it is one of the curated DOM attribute wrapper types (`EXPANDABLE_DOM_ATTRIBUTE_TYPE_NAMES`)

Key invariant: **never call `getType().getProperties()` on a type that extends a DOM attribute wrapper** — this produces hundreds of inflated props. Use `extractPropsFromInterfaceDeclaration` (which restricts to own-declared members) or `getSyntheticDomAttributeProps` (which uses the curated allowlist).

When adding a new DOM attribute wrapper type (e.g., `TableHTMLAttributes`):

1. Add it to `EXPANDABLE_DOM_ATTRIBUTE_TYPE_NAMES` in `react.ts`
2. Specify its curated prop list and optional parent type
3. Write a test that verifies the prop count stays bounded

## Import Generation Internals

The generation package (`packages/experience-design-system-generation`) owns agent invocation and prompt building; the CLI's `src/generate/command.ts` calls it:

- `src/prompt-builder.ts` — combines a skill file with a runtime preamble; walks up from the compiled output to locate `skills/`
- `src/agent-runner.ts` — spawns the agent; parses tool-call output
- `src/agent-invoker.ts`, `src/agent-names.ts`, `src/progress.ts` — agent selection and progress reporting
- `skills/generate-components.md`, `skills/generate-tokens.md`, `skills/select-components.md` and `skills/map-tokens.md` — the skill instructions shipped with the package

The CLI's `src/generate/command.ts` handles validation, session resolution, caching, concurrency, retries and writing results to the session DB.

Raw components are loaded from the session DB and embedded as an inline JSON block in the prompt — the agent never reads a file path. `PromptOptions.rawComponentsInline` carries this string; `rawComponentsPath` does not exist.

The output protocol for internal component and token generation: the agent emits one JSON tool-call object per line to stdout (no sentinel markers). `parseToolCallLines()` in `agent-runner.ts` handles line-by-line parsing.

The output protocol for the selection agent: the agent emits exactly one JSON object on a single line — either `{"tool":"select_component",...}` or `{"tool":"reject_component",...}`. `parseSelectToolCallLines()` in `agent-runner.ts` handles parsing.

**Do not use agent SDKs or APIs** — the import wizard invokes agents as subprocesses only. This is a firm constraint.

## The Selection Agent

`src/import/tui/run-selection-agent.ts` runs one agent invocation per component during the wizard's `extracting` step to decide whether each component belongs in Contentful ExO as a Component Type. The decisions feed the `scope-gate` step, where the operator confirms or changes them.

- Runs with concurrency 10 (respects `EDS_GENERATE_CONCURRENCY`)
- Stores accept and reject decisions, with rationale, in the pipeline DB (`raw_components.reject_reason`)
- `--prompt select=<file-or-text>` overrides its prompt

**Selection criteria**: accept any component that renders visible UI — atoms, molecules, and organisms are all valid Component Types in ExO. Reject only: React hooks, pure context providers, A/B testing or variant-routing wrappers (whose _entire_ purpose is routing), analytics trackers, security utilities. A component is not rejected merely because it has few props, is low-level, or contains some personalization-related props.

The skill file `skills/select-components.md` in the generation package provides detailed instructions and examples. The preamble is built by `buildSelectAutonomousPreamble()` in `prompt-builder.ts`.

## The Apply Command

`src/apply/` contains:

- `command.ts` — registers `apply`; loads CDF/DTCG artifacts or a session, builds manifests, and drives preview/apply operation polling
- `tokens.ts` — token helpers shared with the wizard's preview step
- `api-client.ts` — `ImportApiClient` calls the generated sources API client for token validation, manifest preview, manifest apply, and operation polling
- `preview-utils.ts` — detects empty server previews before confirmation or apply
- `tui/` — server preview, selection, and apply-progress views

The apply flow validates the target, builds a `ManifestPayload` through the shared manifest utilities from the CDF components and DTCG token entries, previews it, optionally confirms, submits it to the apply endpoint, and polls the returned operation to completion. Breaking-change acknowledgement is sent as an operation option; entities absent from the manifest are skipped.

## The Wizard (interactive)

`src/import/tui/WizardApp.tsx` is the import wizard. There is no headless mode: `experiences import` requires an interactive terminal. State transitions live in `wizard-state-transitions.ts`; the step components are in `src/import/tui/steps/`. `WizardApp` reads pipeline-DB state itself and passes it directly to the step components; `ScopeGateStep` and `GenerateReviewStep` each guard their own missing-session/empty-components case. `runLivePreview.ts` re-runs the diff after each FieldEditor save. Extraction and generation run as `__extract` and `__generate` subprocesses.

The new CLI's Import option (`packages/experience-design-system-cli/src/tui/import/`) spawns the bundled legacy `import` (`spawn-v1-import.ts`, `src/legacy/`) rather than reimplementing the wizard.

## TUI Components

All TUI components are standard React functional components rendered by Ink. They live in:

- `src/analyze/select/tui/` — shared editor pieces (`TopBar`, `useImmediateInput`, theme `PALETTE`) reused by the wizard
- `src/print/` — hidden `print` command and `validate` view
- `src/apply/tui/` — `SummaryView`, `EntityDiffView`, `ServerApplyView`
- `src/import/tui/` — the wizard: `WizardApp` and step components in `steps/` (`ScopeGateStep`, `GenerateReviewStep`, `WizardPreviewStep`, `PreviewValidationErrorStep`, `PushingStep`, `DoneStep`, `ErrorStep`, `GateStep`, `RunningStep`)
- `packages/experience-design-system-cli/src/tui/` — the new CLI's TUI; see `DSI_TUI_ARCHITECTURE.md` in that package

When writing TUI tests, use `ink-testing-library`. Set `NO_COLOR=1` in the environment before running tests to suppress ANSI escape codes. Strip ANSI before snapshot assertions if the test renders raw strings.

The `scope-gate` step shows two columns at 100 or more terminal columns (`scope-gate-columns.ts`) and one column below that.

## Session Persistence

**Pipeline sessions** (extraction, internal generation, review) are in `pipeline.db` as described above. Override with `EDS_PIPELINE_DB_PATH`.

The legacy `import.db` is read only by the session migration when present; the current apply flow does not use it for per-entity push resumption.

Run records are appended to `~/.contentful/experience-design-system-cli/state/runs.json` (`src/runs/store.ts`).

## Testing

- Tests live in `test/` mirroring `src/`
- Vitest, no Jest
- CLI integration tests require `dist/` to exist — the test setup compiles if missing
- Snapshot files are committed; update with `--update-snapshots`
- Tests that run extraction or internal generation must set `EDS_PIPELINE_DB_PATH` to an isolated temp path

## Commit Convention

Conventional Commits are enforced by a pre-commit hook:

```
type(scope): description
```

Valid types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, `build`, `revert`

## Pull Requests

- Base branch is `development`, not `main`. Branch off `development` and open PRs against `development`.
- `main` is the release branch — it's what CI publishes stable versions from. Never branch off it or target it directly.

## Sharp Edges

- **DOM prop inflation**: The single most common source of bugs in the React extractor. Always verify extracted prop counts after changing extraction logic. `Button` should have ~32 props, `Input` ~28, SVG icon components ~11.
- **No intermediary JSON files**: Extraction does not write `raw-components.json`. Internal generation reads from the session DB. If you see file-based handoffs, they are wrong.
- **Stacked PRs and Nx affected**: When a base branch is merged to `development` before the stacked branch, `pnpm affected:*` may report "no packages changed" because `NX_BASE` points to the merged tip. This is expected — not a test failure.
- **ESM import paths**: TypeScript source imports `.js` extensions. Do not change them to `.ts`. The TypeScript compiler resolves them correctly.
- **Pre-commit hook failures**: If `lint-staged` or `commitlint` fails, fix the issue and re-commit. Never use `--no-verify`. The pre-commit hook runs `lint:fix` with `--skip-nx-cache` so formatting errors are always caught.

## Architecture Decisions

The one formal ADR, `docs/decisions/0001-cdf-is-the-manifest.md`, covers the CDF-as-manifest decision — read it before changing that boundary. Other technical constraints called out above (the runtime dependency on `typescript`, the DOM prop allowlist strategy, no-intermediary-JSON-files, the `apply` command shape) are firm constraints documented inline in the sections above, not in separate ADR files.

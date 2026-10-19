# Agent Guide

This file tells AI coding agents what they need to know to be productive in this repo. Read it before making changes.

## Repo at a Glance

Nx monorepo with six packages:

- `packages/experience-design-system-cli` — the published CLI (`@contentful/experience-design-system-cli`, bins `experiences`, `exo`, `experience-design-system-cli`) and the interactive import wizard
- `packages/experience-design-system-backend-pipeline` — extraction orchestration, generation, session persistence, in-process validation, and apply operations called directly by the wizard
- `packages/experience-design-system-extraction` — component extraction engine (ts-morph, framework parsers), used by the backend pipeline
- `packages/experience-design-system-generation` — source for the generation and selection skill files copied into the CLI package at build time
- `packages/experience-design-system-client` — generated client for the Experience Design System Integrations API, used by backend apply operations
- `packages/experience-design-system-types` — shared types, schemas, and validation

The supported developer flow is the interactive `experiences import` wizard. It collects project, token, agent, and credential inputs; runs optional token generation, extraction and selection; presents a scope gate; generates accepted definitions; maps tokens when eligible; then reviews, saves, previews, and pushes the result. The CLI calls backend-pipeline functions directly in the same process; extraction and generation are not separate CLI routes.

Unless stated otherwise, `src/...` paths below are relative to `packages/experience-design-system-cli`.

### Wizard step machine (`packages/experience-design-system-cli/src/tui/import/steps/`)

```
extracting (selection agent runs here)
        → scope-gate → generating → final-review → path-prompt
        → previewing → preview-gate → pushing → done
```

The CLI owns the full wizard flow in one process, including extraction, the scope gate, generation, review, save, preview, and push. Choosing skip on the Credentials screen sets `credentialsSkipped` in the `ImportHandoff` and saves files without previewing or pushing.

A single human review gate (`scope-gate`) precedes generation. The final-review step edits names, `$description`, `$default`, `$allowedComponents` and `$values` inline, with source and rationale panels. After final-review the flow always saves one combined `components.json` CDF and, unless credentials were skipped, previews and pushes it.

### Run records

Each successful wizard run appends a record to `~/.contentful/experience-design-system-cli/state/runs.json`. There is no command for listing them.

### Import options

`experiences import` takes `--agent`, `--prompt <stage=value>` and `--no-cache`; the project and token files are collected in the TUI. The selected agent and optional model use `--agent agent:model`; resolution is flag → `credentials.json` → built-in default, and `EDS_AGENT_MODEL_<AGENT>` sets a per-agent model.

## Build System

This repo uses **Nx** for task orchestration. Do not run `tsc` directly — always go through Nx:

```bash
pnpm build          # build all packages
pnpm test           # test all packages
pnpm lint           # lint all packages

# Single package (preferred when iterating)
pnpm -F @contentful/experience-design-system-cli build
pnpm -F @contentful/experience-design-system-backend-pipeline test
pnpm -F @contentful/experience-design-system-backend-pipeline typecheck
```

## TypeScript

- All packages use `"type": "module"` — ESM only. Use `.js` extensions in import paths even when the source is `.ts`.
- `tsconfig.json` has `"jsx": "react-jsx"` — Ink components work without any extra config.
- Ink 5 is ESM-only. Do not add `require()` calls.
- `typescript` is a **runtime** dependency of the CLI (it compiles customer code at analysis time).

## Pipeline Session Database

All intermediary data between import stages flows through a SQLite session database — there are no intermediary JSON files for extracted component data. The database is at `~/.contentful/experience-design-system-cli/pipeline.db` and is accessed via Node's built-in `DatabaseSync` (not `better-sqlite3`).

The session layer lives in `packages/experience-design-system-backend-pipeline/src/persistence/src/session/repositories/db.ts`:

- `openPipelineDb(path?)` — opens (and initializes) the DB; uses `EDS_PIPELINE_DB_PATH` env or the default path
- `getOrCreateSession(db, sessionFlag, name, hints)` — creates or resumes a session
- `createStep(db, sessionId, command, inputs)` — creates a step, marking any prior pending step as interrupted
- `updateStep(db, stepId, status, outputs, error?)` — marks a step complete or failed
- `storeRawComponents(db, sessionId, components)` — idempotent DELETE+INSERT; replaces all raw components for the session
- `loadRawComponents(db, sessionId)` — returns `RawComponentDefinition[]` from the session

The backend token-mapping stage (`packages/experience-design-system-backend-pipeline/src/steps/generation/src/controller/map-tokens/`) runs inside import after component generation when eligible. It deterministically resolves a canonical DTCG path, or a unique token-kind-compatible normalized terminal member, from `tokenReference` when present and otherwise from the extracted default. It preserves the extracted default in `raw_props`; unresolved or ambiguous matches remain unchanged and produce diagnostics. The stage can also invoke the coding agent to infer `$token.allowed` paths for design-category token properties; deterministic default resolution is independent of that inference.

The session stores the default projection in the `raw_token_name_paths` sidecar (`raw_name`, canonical DTCG `path`, and `source` of `automatic` or `manual`). `raw_prop_token_paths` stores ordered token-path lists per component property and records whether a list is an agent suggestion or a review decision. CDF loading projects a compatible resolved path into `$default` while retaining the raw extracted default when no valid resolution exists; only non-empty allowed lists are projected as `$token.allowed`.

**Do not write intermediary JSON files for extracted component data.** The handoff from extraction to generation flows through the session DB. The `tokens.json` file produced by token generation is an output artifact, separate from that component-data handoff.

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

The CLI owns wizard routing and calls the backend pipeline directly. The backend pipeline owns the prompt builder, agent invocation, generation, and persistence:

- `packages/experience-design-system-cli/src/tui/import/steps/06-extraction/` runs extraction and selection, and starts optional token generation
- `packages/experience-design-system-cli/src/tui/import/steps/08-generation/` runs component generation and eligible token mapping
- `packages/experience-design-system-backend-pipeline/src/agents/prompts/` builds prompts from a skill file and runtime preamble; its prompt loader resolves bundled fallback skills
- `packages/experience-design-system-backend-pipeline/src/orchestrators/` owns component and token generation sessions
- `packages/experience-design-system-generation/skills/` is the source of the skill files copied into `packages/experience-design-system-cli/skills/` by the CLI `copy-assets` target
- Matching fallback skill copies live under `packages/experience-design-system-backend-pipeline/src/agents/skills/`; the CLI passes its packaged skill paths to backend generation

Generated data stays in the backend session database until the CLI review and save flow. Generated component and token data are validated within the import path; generation agents use the pre-emit output checklist and warning rules rather than a separate CLI validation route.

Raw components are loaded from the session DB and embedded as an inline JSON block in the prompt — the agent never reads a file path. `PromptOptions.rawComponentsInline` carries this string; `rawComponentsPath` does not exist.

The output protocol for component and token generation: the agent emits one JSON tool-call object per line to stdout. The backend pipeline parses these lines in `packages/experience-design-system-backend-pipeline/src/agents/parsers/parse-tool-calls.ts` and `parse-token-tool-calls.ts`.

The output protocol for the selection agent: the agent emits exactly one JSON object on a single line — either `{"tool":"select_component",...}` or `{"tool":"reject_component",...}`. The backend pipeline parses it in `packages/experience-design-system-backend-pipeline/src/agents/parsers/parse-select-tool-calls.ts`.

**Do not use agent SDKs or APIs** — the import wizard invokes agents as subprocesses only. This is a firm constraint.

## The Selection Agent

`packages/experience-design-system-cli/src/tui/import/steps/06-extraction/selection.ts` runs during extraction after the backend pipeline creates a session. It makes one agent call for undecided components to decide whether each belongs in Contentful ExO as a Component Type. The decisions feed the scope gate (`steps/07-scope-gate`), where the operator confirms or changes them.

- Skips components whose decision is cached (keyed on the component, the prompt and the CLI version); `--no-cache` asks again for everything
- Times out after 5 minutes (`EDS_AGENT_TIMEOUT_MS`), and writes nothing if the call fails
- Stores accept and reject decisions, with rationale, in the pipeline DB (`raw_components.reject_reason`)
- `--prompt select=<file-or-text>` overrides its prompt

**Selection criteria**: accept any component that renders visible UI — atoms, molecules, and organisms are all valid Component Types in ExO. Reject only: React hooks, pure context providers, A/B testing or variant-routing wrappers (whose _entire_ purpose is routing), analytics trackers, security utilities. A component is not rejected merely because it has few props, is low-level, or contains some personalization-related props.

The skill file `packages/experience-design-system-generation/skills/select-components.md` provides detailed instructions and examples. The backend pipeline owns prompt assembly and agent invocation.

## The Import Apply Flow

The CLI's `steps/10-flow/` owns saving, preview, confirmation, and push inside the import wizard; there is no separate apply command. The save stage builds and validates the combined CDF. Backend-pipeline apply operations use `ImportApiClient` for preview, apply, and operation polling. Breaking-change acknowledgement is sent as an operation option; entities absent from the manifest are skipped.

## The Wizard (interactive)

`packages/experience-design-system-cli/src/tui/import/steps/` owns the interactive import wizard. There is no headless mode: `experiences import` requires an interactive terminal. The CLI owns screen and step routing and calls backend-pipeline functions directly for extraction, generation, session access, validation, and apply operations. Coding-agent work runs as a subprocess of the backend pipeline.

## TUI Components

All TUI components are standard React functional components rendered by Ink. They live in:

- `packages/experience-design-system-cli/src/tui/import/steps/` — import, review, preview, and push screens
- `packages/experience-design-system-cli/src/tui/` — CLI TUI components and shared terminal UI

When writing TUI tests, use `ink-testing-library`. Set `NO_COLOR=1` in the environment before running tests to suppress ANSI escape codes. Strip ANSI before snapshot assertions if the test renders raw strings.

The scope gate (`steps/07-scope-gate`) shows two columns at 100 or more terminal columns (`columns.ts`) and one column below that.

## Session Persistence

**Pipeline sessions** (extraction, internal generation, review) are in `pipeline.db` as described above. Override with `EDS_PIPELINE_DB_PATH`.

The legacy `import.db` is read only by the session migration when present; the current apply flow does not use it for per-entity push resumption.

Run records are appended to `~/.contentful/experience-design-system-cli/state/runs.json` by the import flow.

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

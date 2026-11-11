# Agent Guide

This file tells AI coding agents what they need to know to be productive in this repo. Read it before making changes.

## Repo at a Glance

Nx monorepo with four packages:

- `packages/experience-design-system-cli` — the published CLI (`@contentful/experience-design-system-cli`, bins `experiences`, `exo`, `experience-design-system-cli`). An Ink TUI. `experiences import` and bare `experiences` open it. `import` is the only command (`program.ts`, `packages/experience-design-system-cli/src/commands/import.ts`); everything else (settings, help, the import wizard) is a screen inside the TUI. It contains no pipeline logic of its own: the wizard screens call into the backend-pipeline package
- `packages/experience-design-system-backend-pipeline` — all pipeline logic (`@contentful/experience-design-system-backend-pipeline`): extraction, composition, selection, agent invocation and prompts, generation, apply, the SQLite session database, run records, credentials and analytics. Everything it offers the CLI is exported from `packages/experience-design-system-backend-pipeline/src/index.ts`
- `packages/experience-design-system-client` — generated API client for the Experience Design System Integrations API (from `packages/experience-design-system-client/openapi.json` via `@hey-api/openapi-ts`, `pnpm -F @contentful/experience-design-system-client codegen`); used by the backend-pipeline's apply step
- `packages/experience-design-system-types` — shared types, schemas, validation (CDF, DTCG, `handoff`, config, property contract)

The CLI extracts React/Vue/Svelte/Astro/Angular/Stencil/Web Component definitions from customer codebases using the TypeScript compiler API (ts-morph), invokes a coding agent to produce CDF artifacts, validates them against JSON schemas, and provides interactive terminal UIs (Ink) for reviewing, finalizing, and pushing them to Contentful ExO.

The import pipeline runs inside `experiences import`: **extract → compose → selection agent → scope gate → generation → review → save → preview → push (apply).** The first screen asks what to import: tokens and components, tokens only, or components only. When a raw token source is supplied, token generation runs alongside component extraction and token mapping runs after generation. A tokens-only import skips extraction, selection, the scope gate and generation: it generates tokens, shows them for review, then goes to save, preview and push.

### Where things live

| Stage                         | Code                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wizard screens                | `packages/experience-design-system-cli/src/tui/import/steps/` (numbered `00-preflight` … `10-flow`)                                                                                                                                                                                                                                           |
| Extraction                    | `packages/experience-design-system-backend-pipeline/src/steps/extraction/src/` (entry point `packages/experience-design-system-backend-pipeline/src/steps/extraction/src/controller/extract-components-endpoint.ts`, per-framework code in `packages/experience-design-system-backend-pipeline/src/steps/extraction/src/framework-adapters/`) |
| Extraction orchestration      | `packages/experience-design-system-backend-pipeline/src/orchestrators/run-extract-and-compose-session/run-extract-and-compose-session.ts` (extraction cache, composition, session DB)                                                                                                                                                         |
| Composition (slot graph)      | `packages/experience-design-system-backend-pipeline/src/steps/composition/src/`                                                                                                                                                                                                                                                               |
| Selection agent               | CLI side `packages/experience-design-system-cli/src/tui/import/steps/06-extraction/selection.ts`; library side `packages/experience-design-system-backend-pipeline/src/steps/selection/src/`                                                                                                                                                  |
| Generation                    | `packages/experience-design-system-backend-pipeline/src/steps/generation/src/` and `packages/experience-design-system-backend-pipeline/src/orchestrators/run-generate-components-session/` and `packages/experience-design-system-backend-pipeline/src/orchestrators/run-generate-tokens-session/`                                            |
| Agent invocation and prompts  | `packages/experience-design-system-backend-pipeline/src/agents/` (skills in `packages/experience-design-system-backend-pipeline/src/agents/skills/`)                                                                                                                                                                                          |
| Apply (preview and push)      | `packages/experience-design-system-backend-pipeline/src/steps/apply/src/`; driven by `packages/experience-design-system-cli/src/tui/import/steps/10-flow/flow/preview.ts` and `packages/experience-design-system-cli/src/tui/import/steps/10-flow/flow/push.ts`                                                                               |
| Session DB, runs, credentials | `packages/experience-design-system-backend-pipeline/src/persistence/src/`                                                                                                                                                                                                                                                                     |

Each step directory under `packages/experience-design-system-backend-pipeline/src/steps/` (apply, composition, extraction, generation, selection) has its own AGENTS.md in its `src` subdirectory, for example `packages/experience-design-system-backend-pipeline/src/steps/extraction/src/AGENTS.md`, describing that step's inputs, outputs and cache. Read it before changing the step.

### Wizard step machine (`packages/experience-design-system-cli/src/tui/import/steps/`)

```
00-preflight → 01-welcome → 02-token-input → 03-path-validation → 04-credentials
        → 06-extraction (selection agent runs here)
        → 07-scope-gate → 08-generation → 09-review → 10-flow (save → preview → push → done)
```

Which steps a run uses depends on the choice made in `00-preflight` (the lists are in `packages/experience-design-system-cli/src/tui/import/steps/00-preflight/logic.ts`):

- **Tokens and components** asks for the project folder (`01-welcome`), the tokens file (`02-token-input`), confirms the file scan (`03-path-validation`), then follows the diagram above.
- **Components only** is the same without `02-token-input`.
- **Tokens only** asks for the tokens file and the credentials, generates the tokens, shows them in `05-token-review`, then goes straight to `10-flow`. It skips `01-welcome`, `03-path-validation`, `06-extraction`, `07-scope-gate`, `08-generation` and `09-review`.

The steps run in one process and hand data on through the session database and `ImportHandoff` (`packages/experience-design-system-types/src/handoff/index.ts`). Each step directory holds its screen component plus its logic; `06-extraction`, `08-generation` and `10-flow` also hold the code that calls the backend-pipeline. Screens shared across steps (`gate-step`, `running-step`, `error-step`, `overview-box`) are in `packages/experience-design-system-cli/src/tui/import/shared/`. The preview-validation error screen is `packages/experience-design-system-cli/src/tui/import/steps/preview-validation-error/`.

A single human review gate (`07-scope-gate`) precedes generation. The `09-review` step edits names, `$description`, `$default`, `$allowedComponents` and `$values` inline, with source and rationale panels. After review, `10-flow` always saves one combined `components.json` CDF (`packages/experience-design-system-cli/src/tui/import/steps/10-flow/flow/save.ts`) and previews and pushes it. The `04-credentials` screen has no skip option: it continues only once the credentials validate. `credentialsSkipped` is still carried in the handoff and `10-flow` still honours it (files are saved, the preview is bypassed and push is refused), but nothing sets it to `true` today.

### Run records

Run records are appended to `~/.contentful/experience-design-system-cli/state/runs.json` by `packages/experience-design-system-backend-pipeline/src/persistence/src/runs/services/append-run.ts`. There is no command for listing them.

### Import options

`experiences import` opens the TUI; the project and tokens file are collected on the TUI's own screens. Agent and model resolve to the agent saved in the TUI settings (`config.json`, `packages/experience-design-system-cli/src/tui/settings/configuration/agents/agent-store.ts`) → the built-in default (see `resolveAgentChoice` in `packages/experience-design-system-cli/src/tui/import/steps/06-extraction/logic.ts`). `EDS_AGENT_MODEL_<AGENT>` sets a per-agent model (`packages/experience-design-system-backend-pipeline/src/agents/helpers/resolution/resolve-agent-model.ts`).

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

The CLI's `build` target bundles the CLI and the TUI app into the package's dist directory with esbuild and, in its `copy-assets` step, copies the agent skill files from `packages/experience-design-system-backend-pipeline/src/agents/skills/` in backend-pipeline into the CLI package's generated, untracked skills directory (see `packages/experience-design-system-cli/project.json`). Edit skills only in backend-pipeline. If you see Nx cache issues after structural changes, run:

```bash
pnpm -F @contentful/experience-design-system-cli clean && pnpm build
```

## TypeScript

- All packages use `"type": "module"` — ESM only. Use `.js` extensions in import paths even when the source is `.ts`.
- `tsconfig.json` has `"jsx": "react-jsx"` — Ink components work without any extra config.
- Ink 5 is ESM-only. Do not add `require()` calls.
- `typescript` is a **runtime** dependency of the CLI (it compiles customer code at analysis time).

## Pipeline Session Database

All intermediary data between pipeline stages flows through a SQLite session database — there are no intermediary JSON files. The database is at `~/.contentful/experience-design-system-cli/pipeline.db` and is accessed via Node's built-in `DatabaseSync` (`node:sqlite`, not `better-sqlite3`).

The session layer lives in `packages/experience-design-system-backend-pipeline/src/persistence/src/session/` (schema and most queries in `packages/experience-design-system-backend-pipeline/src/persistence/src/session/repositories/db.ts`; all of it is re-exported from `packages/experience-design-system-backend-pipeline/src/index.ts`):

- `openPipelineDb(path?)` — opens (and initializes) the DB; uses `EDS_PIPELINE_DB_PATH` env or the default path
- `getOrCreateSession(db, sessionFlag, name, hints)` — creates or resumes a session
- `createStep(db, sessionId, command, inputs)` — creates a step, marking any prior pending step as interrupted
- `updateStep(db, stepId, status, outputs, error?)` — marks a step complete or failed
- `storeRawComponents(db, sessionId, components, options?)` — idempotent DELETE+INSERT; replaces all raw components for the session (`{ preserveStatus: true }` keeps the selection decisions)
- `loadRawComponents(db, sessionId)` — returns `RawComponentDefinition[]` from the session

`configRoot()` (`packages/experience-design-system-backend-pipeline/src/persistence/src/session/helpers/config-root.ts`, overridable with `EDS_HOME`) is the single source of truth for where files go on disk: `config.json`, `pipeline.db`, `reviews/`, `state/runs.json`. Credentials are read and written by `packages/experience-design-system-backend-pipeline/src/persistence/src/credentials/`.

The token mapping stage (`packages/experience-design-system-backend-pipeline/src/steps/generation/src/controller/map-tokens/run-map-tokens.ts`, called from `packages/experience-design-system-cli/src/tui/import/steps/08-generation/map-tokens.ts` in the CLI) runs after generated CDF and DTCG data are in the session. It deterministically resolves a canonical DTCG path, or a unique token-kind-compatible normalized terminal member, from `tokenReference` when present and otherwise from the extracted default (`packages/experience-design-system-backend-pipeline/src/steps/generation/src/controller/token-defaults/resolve-token-defaults.ts`). It preserves the extracted default in `raw_props`; unresolved or ambiguous matches remain unchanged and produce diagnostics. It then optionally invokes the coding agent to infer `$token.allowed` paths for design-category token properties. `skipAgent` skips only that agentic inference; deterministic default resolution still runs.

The session stores the default projection in the `raw_token_name_paths` sidecar table (`raw_name`, canonical DTCG `path`, and `source` of `automatic` or `manual`). `raw_prop_token_paths` stores ordered token-path lists per component property and records whether a list is an agent suggestion or a review decision. CDF loading projects a compatible resolved path into `$default` while retaining the raw extracted default when no valid resolution exists; only non-empty allowed lists are projected as `$token.allowed`.

**Do not write intermediary JSON files for extracted component data.** The handoff from extraction to generation flows through the session DB. The explicit `tokens.json` produced by optional token generation (`packages/experience-design-system-backend-pipeline/src/orchestrators/run-generate-tokens-session/helpers/write-tokens-file.ts`) is a separate input sidecar for component generation or apply.

**`DatabaseSync` synchronous write invariant:** multi-statement operations use explicit `BEGIN`/`COMMIT`/`ROLLBACK` (see `packages/experience-design-system-backend-pipeline/src/persistence/src/session/repositories/shared/with-transaction.ts`). SIGINT and crash cannot produce partially-written state. Do not add async alternatives to this path.

In tests, set `EDS_PIPELINE_DB_PATH` to a temp path to avoid polluting the developer's real DB.

## The React Extractor

`packages/experience-design-system-backend-pipeline/src/steps/extraction/src/framework-adapters/react/extract-react-components.ts` is the most complex extraction file (~2500 lines); the other frameworks have their own adapter under `packages/experience-design-system-backend-pipeline/src/steps/extraction/src/framework-adapters/`. Shared TSX logic is in `packages/experience-design-system-backend-pipeline/src/steps/extraction/src/framework-adapters/shared/`. Before editing the React extractor:

1. Understand the DOM attribute prop surfacing strategy — see "DOM attribute prop surfacing" in `ARCHITECTURE.md`
2. Understand how SVGProps is handled — it is one of the curated DOM attribute wrapper types (`EXPANDABLE_DOM_ATTRIBUTE_TYPE_NAMES`)

Key invariant: **do not expand the full type of a component that extends a DOM attribute wrapper** (`type.getProperties()` on such a type produces hundreds of inflated props). Use `extractPropsFromInterfaceDeclaration` (which restricts to own-declared members) or `getSyntheticDomAttributeProps` (which uses the curated allowlist). Both live in the extractor file above.

When adding a new DOM attribute wrapper type (e.g., `TableHTMLAttributes`):

1. Add it to `EXPANDABLE_DOM_ATTRIBUTE_TYPE_NAMES` in the extractor file
2. Specify its curated prop list and optional parent type
3. Write a test that verifies the prop count stays bounded

## Generation and Agent Internals

Agent invocation and prompt building live in `packages/experience-design-system-backend-pipeline/src/agents/`; the orchestrators in `packages/experience-design-system-backend-pipeline/src/orchestrators/` and the CLI's `packages/experience-design-system-cli/src/tui/import/steps/06-extraction/selection.ts` call them:

- `packages/experience-design-system-backend-pipeline/src/agents/prompts/build-prompt.ts` — combines a skill file with a runtime preamble (`packages/experience-design-system-backend-pipeline/src/agents/prompts/preambles/`); `packages/experience-design-system-backend-pipeline/src/agents/prompts/resolve-skill-path.ts` locates the skill file
- `packages/experience-design-system-backend-pipeline/src/agents/skills/generation/generate-components.md`, `packages/experience-design-system-backend-pipeline/src/agents/skills/generation/generate-tokens.md`, `packages/experience-design-system-backend-pipeline/src/agents/skills/generation/map-tokens.md` and `packages/experience-design-system-backend-pipeline/src/agents/skills/selection/select-components.md` — the skill instructions
- `packages/experience-design-system-backend-pipeline/src/agents/invoker/create-local-cli-agent-invoker.ts` and `packages/experience-design-system-backend-pipeline/src/agents/services/run-agent.ts` — spawn the agent subprocess; `packages/experience-design-system-backend-pipeline/src/agents/services/invoke-agent-with-output.ts` streams its output
- `packages/experience-design-system-backend-pipeline/src/agents/parsers/` — tool-call parsers (generation, selection, token and map-token tool calls, one file each)
- `packages/experience-design-system-backend-pipeline/src/orchestrators/run-generate-components-session/run-generate-components-session.ts` — validation, session resolution, caching, concurrency, retries and writing results to the session DB; `packages/experience-design-system-backend-pipeline/src/steps/generation/src/` holds the generation step itself

Raw components are loaded from the session DB and embedded as an inline JSON block in the prompt — the agent never reads a file path (`rawComponentsInline` in `packages/experience-design-system-backend-pipeline/src/agents/types/prompts.ts`).

The output protocol for component and token generation: the agent emits one JSON tool-call object per line to stdout (no sentinel markers), parsed by `packages/experience-design-system-backend-pipeline/src/agents/parsers/parse-tool-calls.ts`.

The output protocol for the selection agent: the agent emits JSON tool-call lines, `select_component` or `reject_component`, parsed by `packages/experience-design-system-backend-pipeline/src/agents/parsers/parse-select-tool-calls.ts`.

**Do not use agent SDKs or APIs** — the import invokes agents as subprocesses only. This is a firm constraint.

## The Selection Agent

`packages/experience-design-system-cli/src/tui/import/steps/06-extraction/selection.ts` runs in the CLI during the extraction stage, once extraction has stored the components in the session DB. It makes one agent call for the components it has not decided yet to decide whether each belongs in Contentful ExO as a Component Type. The decisions feed the scope gate (`packages/experience-design-system-cli/src/tui/import/steps/07-scope-gate`), where the operator confirms or changes them. `packages/experience-design-system-backend-pipeline/src/steps/selection/src/` holds the library-side selection service and review helpers.

- Skips components whose decision is cached (keyed on the component, the prompt, agent, model and CLI version; cache code in `packages/experience-design-system-backend-pipeline/src/persistence/src/session/cache/selection.ts`); the `noCache` option (threaded through `packages/experience-design-system-cli/app.tsx`; there is no CLI flag for it) asks again for everything. The TUI always sets `noCache: true`, so in practice every import asks again
- Times out after 5 minutes (`EDS_AGENT_TIMEOUT_MS`), and writes nothing if the call fails
- Stores accept and reject decisions, with rationale, in the pipeline DB (`raw_components.reject_reason`)

**Selection criteria**: accept any component that renders visible UI — atoms, molecules, and organisms are all valid Component Types in ExO. Reject only: React hooks, pure context providers, A/B testing or variant-routing wrappers (whose _entire_ purpose is routing), analytics trackers, security utilities. A component is not rejected merely because it has few props, is low-level, or contains some personalization-related props.

The skill file `packages/experience-design-system-backend-pipeline/src/agents/skills/selection/select-components.md` provides detailed instructions and examples. The preamble is built in `packages/experience-design-system-backend-pipeline/src/agents/prompts/preambles/build-select-preamble.ts`.

## Apply (preview and push)

The wizard's `10-flow` step previews and pushes the saved CDF. The CLI side is `packages/experience-design-system-cli/src/tui/import/steps/10-flow/flow/` (preview, push and save each have a file there, sequenced by the controller). It calls `applyComponents` (`packages/experience-design-system-backend-pipeline/src/steps/apply/src/controller/endpoint/apply-components-endpoint.ts`), which uses `ApiClient` (`packages/experience-design-system-backend-pipeline/src/steps/apply/src/helpers/api-client/api-client.ts`) on top of `@contentful/experience-design-system-client`. Slot-cycle and unresolved-slot-reference checks are in `packages/experience-design-system-backend-pipeline/src/steps/apply/src/controller/validation/`; preview annotation and EDSI error parsing are in `packages/experience-design-system-backend-pipeline/src/steps/apply/src/controller/preview/` and `packages/experience-design-system-backend-pipeline/src/steps/apply/src/controller/errors/`. There is no standalone `apply` command.

## TUI Components

All TUI components are standard React functional components rendered by Ink. They live in `packages/experience-design-system-cli/src/tui/`; see `packages/experience-design-system-cli/DSI_TUI_ARCHITECTURE.md` for the engineering standard:

- `packages/experience-design-system-cli/src/tui/home/` — the home screen
- `packages/experience-design-system-cli/src/tui/import/` — the wizard: `packages/experience-design-system-cli/src/tui/import/steps/` (see the step machine above) and `packages/experience-design-system-cli/src/tui/import/shared/`
- `packages/experience-design-system-cli/src/tui/settings/` — configuration (agents, project), debug mode and analytics opt-in screens
- `packages/experience-design-system-cli/src/tui/help/` — help screens
- `packages/experience-design-system-cli/src/tui/shared/components/` — `ControlHints`, `StepHeader`, `FieldForm`, `ClearableTextInput`

Colors come from the shared `PALETTE` in `packages/experience-design-system-cli/src/tui/theme.ts`, imported as `@tui/theme.js` (the `@tui/*` alias maps to `src/tui/*`; it is set in `tsconfig.json` and `vitest.config.ts`). Do not hardcode colours or define another palette. Control hints use `ControlHints` and the import's step tabs use `StepHeader`, both in `packages/experience-design-system-cli/src/tui/shared/components/`.

When writing TUI tests, use `ink-testing-library`. The test config sets `FORCE_COLOR=3` (`packages/experience-design-system-cli/vitest.config.ts`), so `NO_COLOR` is ignored and rendered output contains ANSI colour codes. Strip them before comparing text (the pattern is in `packages/experience-design-system-cli/test/e2e/harness.ts`).

The scope gate (`packages/experience-design-system-cli/src/tui/import/steps/07-scope-gate`) shows two columns (components and tokens) when there are tokens and the terminal is 100 or more columns wide (`packages/experience-design-system-cli/src/tui/import/steps/07-scope-gate/columns.ts`) and one column otherwise.

## Debug Logs and the Support Zip

Every import step writes a markdown debug log through `startDebugRun` and `finishDebugRun` in `packages/experience-design-system-cli/src/tui/debug-store.ts`. The logs go to `<base>/.contentful/<date>-session-<n>/debug/import/<NN-step>/` and are written only while Debug Mode is on, which it is by default. When you add or change an import step, give it a log the same way. Never write the CMA token into a log; the credentials log has a test for that (`packages/experience-design-system-cli/test/import/04-credentials/credentials-log.test.ts`).

When a step ends on the shared error screen (`ErrorStep`), `packages/experience-design-system-cli/src/tui/support-bundle.ts` zips the session's logs next to the `debug` folder and shows where the file is, so the user can send it to Contentful support. It first waits for the failing step's own log to finish writing (`settleDebugLogs`), and builds the zip with `packages/experience-design-system-cli/src/tui/zip.ts`, which needs no extra dependency.

## Session Persistence

**Pipeline sessions** (extraction, generation, review) are in `pipeline.db` as described above. Override with `EDS_PIPELINE_DB_PATH`. Per-session review state files are under `reviews/` (`packages/experience-design-system-backend-pipeline/src/persistence/src/review-session/`).

Run records are appended to `~/.contentful/experience-design-system-cli/state/runs.json` (`packages/experience-design-system-backend-pipeline/src/persistence/src/runs/`).

## Testing

- CLI tests live in `packages/experience-design-system-cli/test/`, laid out like the CLI's own `src/` (for example `test/import/` for `src/tui/import/steps/`). The end-to-end scenarios are in `test/e2e/` (see below)
- Backend-pipeline tests live next to each module (`src/steps/*/test/`, `packages/experience-design-system-backend-pipeline/src/persistence/test/`) and in `packages/experience-design-system-backend-pipeline/test/`
- Vitest, no Jest
- Tests that run extraction or generation must set `EDS_PIPELINE_DB_PATH` to an isolated temp path

## End-to-End Import Tests

`packages/experience-design-system-cli/test/e2e/` renders the real app, types the keystrokes a person would, and goes from the first screen to the Done screen for each import choice (both, components only, tokens only). Only the agent and Contentful are fake: a fake `claude` binary (the pipeline reads `EDS_AGENT_BINARY_CLAUDE`) and a local server whose address is typed in as the API host. Everything else is real, and each scenario checks the saved CDF against the schema.

- The fixture project in `test/e2e/fixtures/` is a copy of another project's components and tokens file. Do not edit it; lint and typecheck skip it.
- Run one scenario with `pnpm nx test experience-design-system-cli -- -t "tokens only"` (or `"components only"`, `"both"`).
- A screen attaches its key handler just after it draws, so a key sent too early is lost on a slow machine. The harness waits for each screen to stop redrawing after `waitForText`; keep using it before pressing a key.

## Commit Convention

Conventional Commits are enforced by commitlint in the `commit-msg` hook (`.husky/commit-msg`):

```
type(scope): description
```

Valid types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `test`, `perf`, `ci`, `build`, `revert`

## Pull Requests

- Base branch is `development`, not `main`. Branch off `development` and open PRs against `development`.
- PR titles follow Conventional Commits and end with the Jira ticket, for example `[INTEG-1234]`. CI checks both.
- `main` is the release branch — it's what CI publishes stable versions from. Never branch off it, and only release PRs from `development` target it (see "Release Process" in `CONTRIBUTING.md`).

## Sharp Edges

- **DOM prop inflation**: The single most common source of bugs in the React extractor. Always verify extracted prop counts after changing extraction logic; a component that extends a DOM attribute type should surface its own props plus the curated allowlist, not hundreds of DOM props.
- **No intermediary JSON files**: Extraction does not write `raw-components.json`. Generation reads from the session DB. If you see file-based handoffs for component data, they are wrong.
- **Stacked PRs and Nx affected**: When a base branch is merged to `development` before the stacked branch, `pnpm affected:*` may report "no packages changed" because `NX_BASE` points to the merged tip. This is expected — not a test failure.
- **ESM import paths**: TypeScript source imports `.js` extensions. Do not change them to `.ts`. The TypeScript compiler resolves them correctly.
- **Pre-commit hook failures**: If `lint-staged` or `commitlint` fails, fix the issue and re-commit. Never use `--no-verify`. The pre-commit hook runs `lint:staged` (`.husky/pre-commit`), so formatting errors are always caught.

## Architecture Decisions

The one formal ADR, `docs/decisions/0001-cdf-is-the-manifest.md`, covers the CDF-as-manifest decision — read it before changing that boundary. Other technical constraints called out above (the runtime dependency on `typescript`, the DOM prop allowlist strategy, no-intermediary-JSON-files, subprocess-only agent invocation) are firm constraints documented inline in the sections above, not in separate ADR files.

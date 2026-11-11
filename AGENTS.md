# Agent Guide

What AI coding agents need to know to be productive in this repo. Read it before making changes. `ARCHITECTURE.md` has the full picture; this file has the rules and the sharp edges.

Path shorthand used below:

- `BP/` = `packages/experience-design-system-backend-pipeline/src/`
- `CLI/` = `packages/experience-design-system-cli/`
- `STEPS/` = `packages/experience-design-system-cli/src/tui/import/steps/`

## Repo at a Glance

Nx monorepo with four packages:

- **`CLI/`** (`@contentful/experience-design-system-cli`, bins `experiences`, `exo`, `experience-design-system-cli`): the published Ink TUI. `import` is the only command (`program.ts`, `CLI/src/commands/import.ts`) and bare `experiences` runs it. Settings, help and the import wizard are screens inside the TUI. It holds no pipeline logic; the wizard screens call the backend pipeline.
- **`packages/experience-design-system-backend-pipeline`**: all pipeline logic (extraction, composition, selection, agent invocation and prompts, generation, apply, the SQLite session database, run records, credentials, analytics). Everything it offers the CLI is exported from `BP/index.ts`.
- **`packages/experience-design-system-client`**: generated Integrations API client (from `openapi.json` via `@hey-api/openapi-ts`; `pnpm -F @contentful/experience-design-system-client codegen`), used by the apply step.
- **`packages/experience-design-system-types`**: shared types, schemas and validation (CDF, DTCG, `handoff`, config, property contract).

The CLI extracts React, Vue, Svelte, Astro, Angular, Stencil and Web Component definitions from customer codebases with the TypeScript compiler API (ts-morph), has a coding agent produce CDF artifacts, validates them against JSON schemas, and lets the user review and push them to Contentful ExO.

The pipeline runs inside `experiences import`: **extract → compose → selection agent → scope gate → generation → review → save → preview → push (apply).** The first screen asks what to import: tokens and components, tokens only, or components only. When a raw token source is supplied, token generation runs alongside extraction and token mapping runs after generation.

### Where things live

| Stage                         | Code                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wizard screens                | `STEPS/` (numbered `00-preflight` … `10-flow`)                                                                                                   |
| Extraction                    | `BP/steps/extraction/src/` (entry `controller/extract-components-endpoint.ts`, per-framework code in `framework-adapters/`)                      |
| Extraction orchestration      | `BP/orchestrators/run-extract-and-compose-session/run-extract-and-compose-session.ts` (extraction cache, composition, session DB)                |
| Composition (slot graph)      | `BP/steps/composition/src/`                                                                                                                      |
| Selection agent               | CLI side `STEPS/06-extraction/selection.ts`; library side `BP/steps/selection/src/`                                                              |
| Generation                    | `BP/steps/generation/src/`, `BP/orchestrators/run-generate-components-session/`, `BP/orchestrators/run-generate-tokens-session/`                 |
| Agent invocation and prompts  | `BP/agents/` (skills in `BP/agents/skills/`)                                                                                                     |
| Apply (preview and push)      | `BP/steps/apply/src/`, driven by `STEPS/10-flow/flow/preview.ts` and `push.ts`                                                                   |
| Session DB, runs, credentials | `BP/persistence/src/`                                                                                                                            |

Each step under `BP/steps/` (apply, composition, extraction, generation, selection) has its own `AGENTS.md` in its `src` folder describing its inputs, outputs and cache. Read it before changing the step.

### Wizard steps (`STEPS/`)

```
00-preflight → 01-welcome → 02-token-input → 03-path-validation → 04-credentials
        → 06-extraction (selection agent runs here)
        → 07-scope-gate → 08-generation → 09-review → 10-flow (save → preview → push → done)
```

The choice in `00-preflight` decides which steps run (the lists are in `00-preflight/logic.ts`):

- **Tokens and components:** the diagram above, with the project folder asked in `01-welcome`, the tokens file in `02-token-input`, and the file scan confirmed in `03-path-validation`.
- **Components only:** the same without `02-token-input`.
- **Tokens only:** tokens file and credentials, token generation, `05-token-review`, then `10-flow`. It skips `01`, `03`, `06`, `07`, `08` and `09`.

The steps run in one process and hand data on through the session database and `ImportHandoff` (`packages/experience-design-system-types/src/handoff/index.ts`). Each step folder holds its screen and logic; `06-extraction`, `08-generation` and `10-flow` also hold the code that calls the backend pipeline. Screens shared across steps (`gate-step`, `running-step`, `error-step`, `overview-box`) are in `CLI/src/tui/import/shared/`; the preview-validation error screen is `STEPS/preview-validation-error/`.

One human gate, `07-scope-gate`, precedes generation. `09-review` edits names, `$description`, `$default`, `$allowedComponents` and `$values` inline. After review, `10-flow` always saves one combined `components.json` CDF (`10-flow/flow/save.ts`), then previews and pushes it. `04-credentials` has no skip option. `credentialsSkipped` is still carried in the handoff and honoured by `10-flow` (files are saved, the preview is bypassed, push is refused), but nothing sets it to `true`.

### Agent and model

The agent and model come from the TUI settings (`config.json`, `CLI/src/tui/settings/configuration/agents/agent-store.ts`), then the built-in default (`resolveAgentChoice` in `STEPS/06-extraction/logic.ts`). `EDS_AGENT_MODEL_<AGENT>` sets a per-agent model (`BP/agents/helpers/resolution/resolve-agent-model.ts`).

## Build System

Nx orchestrates tasks. Do not run `tsc` directly; go through Nx:

```bash
pnpm build          # build all packages
pnpm test           # test all packages
pnpm lint           # lint all packages

# Single package (preferred when iterating)
pnpm -F @contentful/experience-design-system-cli build
pnpm -F @contentful/experience-design-system-backend-pipeline test
pnpm -F @contentful/experience-design-system-backend-pipeline typecheck
```

The CLI `build` bundles the CLI and TUI with esbuild and, in `copy-assets`, copies the agent skill files from `BP/agents/skills/` into the CLI's generated, untracked skills folder (see `CLI/project.json`). Edit skills only in backend-pipeline. If Nx caching misbehaves after structural changes:

```bash
pnpm -F @contentful/experience-design-system-cli clean && pnpm build
```

## TypeScript

- All packages are ESM (`"type": "module"`). Use `.js` extensions in import paths even when the source is `.ts`; do not change them to `.ts`.
- `"jsx": "react-jsx"` is set, so Ink components need no extra config. Ink 5 is ESM-only: do not add `require()`.
- `typescript` is a **runtime** dependency of the CLI (it compiles customer code at analysis time).

## Pipeline Session Database

All data between pipeline stages flows through a SQLite session database at `~/.contentful/experience-design-system-cli/pipeline.db`, opened with Node's built-in `DatabaseSync` (`node:sqlite`, not `better-sqlite3`). **Do not write intermediary JSON files for extracted component data**; extraction hands off to generation through the database. The explicit `tokens.json` from optional token generation (`BP/orchestrators/run-generate-tokens-session/helpers/write-tokens-file.ts`) is a separate input for component generation or apply.

The session layer is `BP/persistence/src/session/` (schema and most queries in `repositories/db.ts`, all re-exported from `BP/index.ts`):

- `openPipelineDb(path?)`: opens and initializes the DB; uses `EDS_PIPELINE_DB_PATH` or the default path
- `getOrCreateSession(db, sessionFlag, name, hints)`: creates or resumes a session
- `createStep(db, sessionId, command, inputs)`: creates a step, marking any prior pending step as interrupted
- `updateStep(db, stepId, status, outputs, error?)`: marks a step complete or failed
- `storeRawComponents(db, sessionId, components, options?)`: idempotent DELETE+INSERT of the session's raw components (`{ preserveStatus: true }` keeps selection decisions)
- `loadRawComponents(db, sessionId)`: returns the session's `RawComponentDefinition[]`

`configRoot()` (`BP/persistence/src/session/helpers/config-root.ts`, overridable with `EDS_HOME`) is the single source of truth for where files go: `config.json`, `pipeline.db`, `reviews/` (per-session review state, `BP/persistence/src/review-session/`) and `state/runs.json`. Credentials are read and written in `BP/persistence/src/credentials/`. Run records are appended to `state/runs.json` by `BP/persistence/src/runs/services/append-run.ts`; no command lists them.

**Synchronous write invariant:** multi-statement operations use explicit `BEGIN`/`COMMIT`/`ROLLBACK` (`BP/persistence/src/session/repositories/shared/with-transaction.ts`), so SIGINT or a crash cannot leave partial state. Do not add async alternatives to this path.

In tests, set `EDS_PIPELINE_DB_PATH` to a temp path so the developer's real DB is untouched.

### Token mapping

The stage (`BP/steps/generation/src/controller/map-tokens/run-map-tokens.ts`, called from `STEPS/08-generation/map-tokens.ts`) runs after generated CDF and DTCG data are in the session. It deterministically resolves a canonical DTCG path, or a unique token-kind-compatible normalized terminal member, from `tokenReference` when present and otherwise from the extracted default (`controller/token-defaults/resolve-token-defaults.ts`). It keeps the extracted default in `raw_props`; unresolved or ambiguous matches stay unchanged and produce diagnostics. It then optionally has the coding agent infer `$token.allowed` paths for design-category token properties. `skipAgent` skips only that inference; default resolution still runs.

Two sidecar tables hold the results. `raw_token_name_paths` stores the default projection (`raw_name`, canonical DTCG `path`, and `source` of `automatic` or `manual`). `raw_prop_token_paths` stores ordered token-path lists per component property and whether each is an agent suggestion or a review decision. CDF loading projects a compatible resolved path into `$default` (keeping the raw default when none resolves) and projects only non-empty allowed lists as `$token.allowed`.

## The React Extractor

`BP/steps/extraction/src/framework-adapters/react/extract-react-components.ts` is the most complex extraction file. The other frameworks have adapters beside it, and shared TSX logic is in `framework-adapters/shared/`. Before editing the React extractor, read "DOM attribute props" in `ARCHITECTURE.md`; SVGProps is one of the curated wrapper types (`EXPANDABLE_DOM_ATTRIBUTE_TYPE_NAMES`).

Key invariant: **do not expand the full type of a component that extends a DOM attribute wrapper** (`type.getProperties()` on such a type yields hundreds of inflated props). Use `extractPropsFromInterfaceDeclaration` (own-declared members only) or `getSyntheticDomAttributeProps` (the curated allowlist). Both are in the extractor file.

To add a DOM attribute wrapper type (for example `TableHTMLAttributes`): add it to `EXPANDABLE_DOM_ATTRIBUTE_TYPE_NAMES`, give it a curated prop list and optional parent type, and write a test that the prop count stays bounded.

## Generation and Agent Internals

Agent invocation and prompt building are in `BP/agents/`, called by the orchestrators and by `STEPS/06-extraction/selection.ts`:

- `prompts/build-prompt.ts` combines a skill file with a runtime preamble (`prompts/preambles/`); `prompts/resolve-skill-path.ts` finds the skill file.
- Skills: `skills/generation/{generate-components,generate-tokens,map-tokens}.md` and `skills/selection/select-components.md`.
- `invoker/create-local-cli-agent-invoker.ts` and `services/run-agent.ts` spawn the agent subprocess; `services/invoke-agent-with-output.ts` streams its output.
- `parsers/` has one tool-call parser per kind (generation, selection, token, map-token).
- `BP/orchestrators/run-generate-components-session/run-generate-components-session.ts` handles validation, session resolution, caching, concurrency, retries and writing results to the DB; `BP/steps/generation/src/` holds the generation step itself.

Raw components come from the session DB and are embedded as an inline JSON block in the prompt; the agent never reads a file path (`rawComponentsInline` in `BP/agents/types/prompts.ts`).

Output protocol: the agent prints one JSON tool-call object per line on stdout, with no sentinel markers. Component and token generation are parsed by `parsers/parse-tool-calls.ts`; the selection agent emits `select_component` or `reject_component` lines, parsed by `parsers/parse-select-tool-calls.ts`.

**Do not use agent SDKs or APIs.** The import invokes agents as subprocesses only. This is a firm constraint.

## The Selection Agent

`STEPS/06-extraction/selection.ts` runs during the extraction stage, once extraction has stored the components in the session DB. It makes one agent call for the components not yet decided, to decide whether each belongs in ExO as a Component Type. The decisions feed the scope gate (`STEPS/07-scope-gate`), where the operator confirms or changes them. `BP/steps/selection/src/` holds the library-side service and review helpers.

- Skips components whose decision is cached (keyed on component, prompt, agent, model and CLI version; code in `BP/persistence/src/session/cache/selection.ts`). `noCache` (threaded through `CLI/app.tsx`; no CLI flag) asks again for everything, and the TUI always sets it, so in practice every import asks again.
- Times out after 5 minutes (`EDS_AGENT_TIMEOUT_MS`) and writes nothing if the call fails.
- Stores accept and reject decisions, with rationale, in the pipeline DB (`raw_components.reject_reason`).

**Selection criteria:** accept any component that renders visible UI; atoms, molecules and organisms are all valid Component Types. Reject only React hooks, pure context providers, A/B testing or variant-routing wrappers (whose _entire_ purpose is routing), analytics trackers and security utilities. Few props, low-level, or some personalization props are not reasons to reject.

The skill file `BP/agents/skills/selection/select-components.md` has detailed instructions and examples; the preamble is built in `BP/agents/prompts/preambles/build-select-preamble.ts`.

## Apply (preview and push)

`10-flow` previews and pushes the saved CDF. The CLI side is `STEPS/10-flow/flow/` (save, preview and push each have a file, sequenced by the controller). It uses `ImportApiClient`, which is the apply step's `ApiClient` (`BP/steps/apply/src/helpers/api-client/api-client.ts`) on top of `@contentful/experience-design-system-client`. Slot-cycle and unresolved-slot checks are in `BP/steps/apply/src/controller/validation/`; preview annotation and EDSI error parsing are in `controller/preview/` and `controller/errors/`. There is no standalone `apply` command.

## TUI Components

All TUI components are React function components rendered by Ink, in `CLI/src/tui/`. See `CLI/DSI_TUI_ARCHITECTURE.md` for the standard.

- `home/` the home screen; `import/` the wizard (`steps/` and `shared/`); `settings/` agents, project, debug mode and analytics opt-in; `help/` help screens
- `shared/components/`: `ControlHints`, `StepHeader`, `FieldForm`, `ClearableTextInput`

Colors come from the shared `PALETTE` in `CLI/src/tui/theme.ts`, imported as `@tui/theme.js` (the `@tui/*` alias maps to `src/tui/*`; set in `tsconfig.json` and `vitest.config.ts`). Do not hardcode colours or define another palette. Use `ControlHints` for key hints and `StepHeader` for the import's step tabs.

TUI tests use `ink-testing-library`. The test config sets `FORCE_COLOR=3` (`CLI/vitest.config.ts`), so `NO_COLOR` is ignored and output contains ANSI codes; strip them before comparing text (the pattern is in `CLI/test/e2e/harness.ts`).

The scope gate (`STEPS/07-scope-gate`) shows two columns (components and tokens) when there are tokens and the terminal is at least 100 columns wide (`columns.ts`), otherwise one.

## Debug Logs and the Support Zip

Every import step writes a markdown debug log through `startDebugRun` and `finishDebugRun` (`CLI/src/tui/debug-store.ts`) to `<base>/.contentful/<date>-session-<n>/debug/import/<NN-step>/`, only while Debug Mode is on (the default). When you add or change an import step, give it a log the same way. Never write the CMA token into a log; the credentials log has a test for that (`CLI/test/import/04-credentials/credentials-log.test.ts`).

When a step ends on the shared error screen (`ErrorStep`), `CLI/src/tui/support-bundle.ts` zips the session's logs next to `debug/` and shows where the file is, so the user can send it to Contentful support. It first waits for the failing step's own log to finish (`settleDebugLogs`), and builds the zip with `CLI/src/tui/zip.ts`, which needs no extra dependency.

## Testing

- CLI tests are in `CLI/test/`, laid out like `CLI/src/` (for example `test/import/` for `STEPS/`). End-to-end scenarios are in `test/e2e/`.
- Backend-pipeline tests live beside each module (`BP/steps/*/test/`, `BP/persistence/test/`) and in `packages/experience-design-system-backend-pipeline/test/`.
- Vitest, no Jest. Tests that run extraction or generation must set `EDS_PIPELINE_DB_PATH` to an isolated temp path.

### End-to-end import tests

`CLI/test/e2e/` renders the real app, types the keystrokes a person would, and goes from the first screen to Done for each import choice (both, components only, tokens only). Only the agent (a fake `claude`, found through `EDS_AGENT_BINARY_CLAUDE`) and Contentful (a local server whose address is typed in as the API host) are fake. Each scenario checks the saved CDF against the schema.

- The fixture project in `test/e2e/fixtures/` is a copy of another project's components and tokens file. Do not edit it; lint and typecheck skip it.
- Run one scenario with `pnpm nx test experience-design-system-cli -- -t "tokens only"` (or `"components only"`, `"both"`).
- A screen attaches its key handler just after it draws, so a key sent too early is lost on a slow machine. The harness waits for the screen to stop redrawing after `waitForText`; keep using it before pressing a key.

## Commits and Pull Requests

Conventional Commits are enforced by commitlint in `.husky/commit-msg`: `type(scope): description`. Valid types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `test`, `perf`, `ci`, `build`, `revert`.

- Base branch is `development`, not `main`. Branch off `development` and open PRs against it.
- PR titles follow Conventional Commits and end with the Jira ticket, for example `[INTEG-1234]`. CI checks both.
- `main` is the release branch that CI publishes stable versions from. Never branch off it; only release PRs from `development` target it (see "Release Process" in `CONTRIBUTING.md`).

## Sharp Edges

- **DOM prop inflation:** the most common source of bugs in the React extractor. After changing extraction logic, check the extracted prop counts: a component that extends a DOM attribute type should surface its own props plus the curated allowlist, not hundreds of DOM props.
- **No intermediary JSON files:** extraction does not write `raw-components.json`; generation reads from the session DB. File-based handoffs for component data are wrong.
- **Stacked PRs and Nx affected:** when a base branch is merged to `development` before the stacked branch, `pnpm affected:*` may report "no packages changed" because `NX_BASE` points to the merged tip. This is expected, not a test failure.
- **Pre-commit failures:** if `lint-staged` or `commitlint` fails, fix the issue and commit again. Never use `--no-verify`. The pre-commit hook runs `lint:staged` (`.husky/pre-commit`).

## Architecture Decisions

The one formal ADR, `docs/decisions/0001-cdf-is-the-manifest.md`, covers CDF as the manifest; read it before changing that boundary. The other firm constraints (the runtime dependency on `typescript`, the DOM prop allowlist, no intermediary JSON files, subprocess-only agent invocation) are documented inline above, not in ADR files.

# Agent Guide

This file tells AI coding agents what they need to know to be productive in this repo. Read it before making changes.

## Repo at a Glance

Nx monorepo with two packages:

- `packages/experience-design-system-cli` — the CLI and TUI (the main package)
- `packages/experience-design-system-types` — shared types, schemas, validation

The CLI extracts React/Vue/Astro/Stencil/Web Component definitions from customer codebases using the TypeScript compiler API (ts-morph), invokes a coding agent to produce CDF artifacts, validates them against JSON schemas, and provides interactive terminal UIs (Ink) for reviewing, finalizing, and pushing them to Contentful ExO.

The commands form a pipeline: **analyze extract → analyze select-agent → generate components → apply push.** The `import` command — exposed as the `experiences import` binary — is the primary entry point and runs the full pipeline behind an interactive **wizard** (Ink TUI) in a real terminal, or a non-interactive headless pipeline when given the right flags. `analyze select-agent` runs one agent invocation per component to decide which components belong in Contentful ExO; `analyze select` (the standalone JsonEditor TUI) is the manual alternative.

### Wizard step machine (`src/import/tui/`)

```
welcome → extracting → [auto-filter (analyze select-agent)] → scope-gate
        → credentials (generate runs in parallel, prefetched) → final-review
        → preview → push-decision-gate → pushing → done
```

A single human review gate (`scope-gate`) replaces the older two-step extract-review + generate-edit gates. The final-review step is a minimum-viable port of the standalone JsonEditor (lifted rationale + source panels, `$default` and `$allowedComponents` editing inline). The push-decision-gate defaults to save AND push.

### Replay system

Each successful wizard run appends a record to `~/.config/experiences/runs.json`:

- `experiences runs` lists prior runs; `experiences runs <id-or-path>` prints the single-run detail view; `--json`, `--pushed` / `--not-pushed` filters apply
- `experiences import --push-from-run <id-or-path>` re-pushes the recorded session without re-opening the wizard or writing to disk
- `experiences import --modify <id-or-path>` is fully wired: loads the recorded session from `pipeline.db` (skipping extract and generate), pre-fills credentials from `pushedTo`, and lands on `final-review` (or `scope-gate` if the run record sets `entryStep`). Pair with `--overwrite` or `--save-as-new`.

Replay helpers live in `src/runs/`: `replay-helpers.ts` (replayRun / modifyRun), `store.ts` (runs.json reader/writer), `resolve-run-target.ts` (id-or-path resolution), `save-path-resolver.ts`, plus the `runs ls` command (`ls-command.ts`). The `runs` table columns auto-expand to fit content (no truncation of long project / save paths); a copy-friendly footer prints command hints for the newest run.

### Run-picker mount

`src/runs/run-picker-mount.ts` decides whether the wizard opens with the interactive run-picker TUI (`src/runs/tui/RunPicker.tsx`) before `welcome`. It mounts when `runs.json` has entries, stdin is a TTY, and none of `--push-from-run`, `--modify`, or `--project` was passed. Selecting a run routes into the `--push-from-run` or `--modify` code path without re-invoking the CLI.

### Read-only rationale view

`experiences analyze select-agent --show-rationale [--json] [--session <id>]` prints the recorded accept / reject rationale for every component in a session. It reads `raw_components.reject_reason` from `pipeline.db` — no LLM call, no schema change, no agent subprocess. `--json` emits a machine-readable array for scripting.

### `--on-conflict` and prompt-print

- `experiences import --on-conflict <overwrite|skip|fail>` bypasses the wizard's interactive `<SaveConflictGate>` when a file already exists at the save path. Mutex with `--no-save`.
- `experiences import --print-prompt` prints the generate prompt to stdout and exits. It replaces the prompt-print semantics of `--dry-run`, which is now deprecated and prints a stderr deprecation notice.
- `experiences import --model <name>` overrides the stored model with fallback order `flag → credentials.json → built-in default`. `--agent <name>` works the same way and is now a functional wizard override.

## Build System

This repo uses **Nx** for task orchestration. Do not run `tsc` directly — always go through Nx:

```bash
pnpm build          # build all packages
pnpm test           # test all packages
pnpm lint           # lint all packages

# Single package (preferred when iterating)
pnpm -F @contentful/experience-design-system-cli build
pnpm -F @contentful/experience-design-system-cli test
pnpm -F @contentful/experience-design-system-cli typecheck
```

The CLI's compiled output lands in `packages/experience-design-system-cli/dist/src/`, not `dist/`. This is because `@nx/js:tsc` preserves the `src/` prefix. If you see Nx cache issues after structural changes, run:

```bash
pnpm -F @contentful/experience-design-system-cli clean && pnpm build
```

## TypeScript

- All packages use `"type": "module"` — ESM only. Use `.js` extensions in import paths even when the source is `.ts`.
- `tsconfig.json` has `"jsx": "react-jsx"` — Ink components work without any extra config.
- Ink v4 is ESM-only. Do not add `require()` calls.
- `typescript` is a **runtime** dependency of the CLI (it compiles customer code at analysis time). See `docs/adr/2026-04-22-typescript-as-runtime-dependency.md`.

## Pipeline Session Database

All intermediary data between commands flows through a SQLite session database — there are no intermediary JSON files. The database is at `~/.contentful/experience-design-system-cli/pipeline.db` and is accessed via Node's built-in `DatabaseSync` (not `better-sqlite3`).

The session layer lives in `src/session/db.ts`:

- `openPipelineDb(path?)` — opens (and initializes) the DB; uses `EDS_PIPELINE_DB_PATH` env or the default path
- `getOrCreateSession(db, sessionFlag, name, hints)` — creates or resumes a session
- `createStep(db, sessionId, command, inputs)` — creates a step, marking any prior pending step as interrupted
- `updateStep(db, stepId, status, outputs, error?)` — marks a step complete or failed
- `storeRawComponents(db, sessionId, components)` — idempotent DELETE+INSERT; replaces all raw components for the session
- `loadRawComponents(db, sessionId)` — returns `RawComponentDefinition[]` from the session

**Do not write intermediary JSON files.** All data between `analyze extract` and `generate components` flows through the session DB. This is a firm constraint — see `docs/adr/2026-05-03-pipeline-intermediary-data-in-sqlite.md`.

**`DatabaseSync` synchronous write invariant:** all multi-statement operations use explicit `BEGIN`/`COMMIT`/`ROLLBACK`. SIGINT and crash cannot produce partially-written state. Do not add async alternatives to this path.

In tests, set `EDS_PIPELINE_DB_PATH` to a temp path to avoid polluting the developer's real DB.

## The React Extractor

`src/analyze/extract/react.ts` is the most complex file (~2500 lines). Before editing it:

1. Understand the DOM attribute prop surfacing strategy — `docs/adr/2026-04-22-dom-attribute-prop-surfacing-strategy.md`
2. Understand how SVGProps is handled — `docs/adr/2026-04-22-svgprops-as-expandable-dom-wrapper.md`

Key invariant: **never call `getType().getProperties()` on a type that extends a DOM attribute wrapper** — this produces hundreds of inflated props. Use `extractPropsFromInterfaceDeclaration` (which restricts to own-declared members) or `getSyntheticDomAttributeProps` (which uses the curated allowlist).

When adding a new DOM attribute wrapper type (e.g., `TableHTMLAttributes`):
1. Add it to `EXPANDABLE_DOM_ATTRIBUTE_TYPE_NAMES` in `react.ts`
2. Specify its curated prop list and optional parent type
3. Write a test that verifies the prop count stays bounded

## The Generate Command

`src/generate/` contains the generate command pipeline:

- `command.ts` — validation, session resolution, agent invocation, sentinel extraction, file writes
- `prompt-builder.ts` — combines a skill file with a runtime preamble; uses `existsSync` walk to locate `skills/` regardless of compiled vs. source context
- `agent-runner.ts` — spawns the agent via `sh -c`; autonomous mode pipes stdout/stderr, interactive inherits stdio
- `edit/command.ts` — `generate components edit` / `generate tokens edit` subcommands; non-interactive flags (`--accept-all`, `--reject`, `--patch`) are implemented; the interactive TUI is not yet available
- `skills/generate-components.md` and `skills/generate-tokens.md` — the actual skill instructions shipped with the package
- `skills/select-components.md` — skill instructions for the `analyze select-agent` command

Raw components are loaded from the session DB and embedded as an inline JSON block in the prompt — the agent never reads a file path. `PromptOptions.rawComponentsInline` carries this string; `rawComponentsPath` does not exist.

The output protocol for `generate components` and `generate tokens`: the agent emits one JSON tool-call object per line to stdout (no sentinel markers). `parseToolCallLines()` in `agent-runner.ts` handles line-by-line parsing.

The output protocol for `analyze select-agent`: the agent emits exactly one JSON object on a single line — either `{"tool":"select_component",...}` or `{"tool":"reject_component",...}`. `parseSelectToolCallLines()` in `agent-runner.ts` handles parsing.

**Do not use agent SDKs or APIs** — the generate command invokes agents as subprocesses only. This is a firm constraint — see `docs/adr/`.

## The Analyze Select-Agent Command

`src/analyze/select-agent/command.ts` implements `analyze select-agent`, which runs one agent invocation per component to decide whether each component belongs in Contentful ExO as a Component Type.

- Runs with concurrency 5 (respects `EDS_GENERATE_CONCURRENCY`)
- Uses `OutputFormatter` for pretty-printing: `+ ComponentName  reason` for accepted, `–  ComponentName  reason` for rejected
- Writes decisions to the review session state file at `~/.contentful/experience-design-system-cli/reviews/<sessionId>/current-review-state.json` (same format as `analyze select` TUI)
- Records an `analyze select` step in the pipeline DB
- Supports `--dry-run` (prints the first component's prompt), `--verbose`, `--model`

**Selection criteria**: accept any component that renders visible UI — atoms, molecules, and organisms are all valid Component Types in ExO. Reject only: React hooks, pure context providers, A/B testing or variant-routing wrappers (whose *entire* purpose is routing), analytics trackers, security utilities. A component is not rejected merely because it has few props, is low-level, or contains some personalization-related props.

The skill file `skills/select-components.md` provides detailed instructions and examples. The preamble is built by `buildSelectAutonomousPreamble()` in `prompt-builder.ts`.

## The Apply Command

`src/apply/` contains:

- `command.ts` — registers `apply` with `preview` + `push` + `select` subcommands (renamed from `import` — see `docs/adr/2026-05-03-apply-command-rename-and-non-interactive-flags.md`)
- `api-client.ts` — `ImportApiClient` with `listComponentTypes()`, `listDesignTokens()`, `putComponentType()`, `putDesignToken()`; all fetch-based, no SDK dependency
- `cdf-mapper.ts` — `mapCDFComponent(key, entry, viewports)` → `ComponentTypeBody`; `designProperties` outer keys are **viewport IDs**, not design property names
- `dtcg-mapper.ts` — `mapDTCGToken(entry)` → `DesignTokenBody`; returns `{ error }` for unknown `$type` values
- `diff.ts` — `computeDiff(components, tokens, client, viewports)` → `DiffResult`; pre-fetches all remote entities once, deep-compares after stripping `sys` metadata
- `session.ts` — apply-specific SQLite session for push resumption; separate from the pipeline session DB
- `importer.ts` — `importTokens` and `importComponents`; handles 401/403 abort, 429 retry, 409 re-fetch, per-entity session recording

**`cdf-mapper.ts` property routing:**
- `$category === 'content'` or `'state'` → `contentProperties[]`
- `$category === 'design'` → `designProperties[]` (outer keys are viewport IDs, not property names)

**`apply select` non-interactive flags:** `--select-all`, `--select <pattern>` (repeatable), `--deselect <pattern>` (repeatable). These skip the TUI.

## The Import Orchestrator (headless)

`src/import/orchestrator.ts` runs the full pipeline in non-interactive mode by shelling out to the CLI binary — it does not re-implement step logic. It captures `session=<id>` from `analyze extract` stdout via `/^session=(.+)$/m` and passes it as `--session` to downstream commands.

By default, headless `import` runs `analyze select-agent` to select components automatically. If `--select-all`, `--select`, or `--deselect` flags are provided, the orchestrator bypasses the agent and uses `analyze select` with those flags instead.

Headless mode is entered when any of these flags are set: `--auto-accept-scope`, `--skip-analyze`, `--skip-generate`, `--skip-apply`, `--yes`, `--dry-run`, or any credential flag. In a non-TTY without one of these flags the command exits 1 with a fail-loud message rather than hanging.

Keep the orchestrator thin. Logic belongs in the individual command implementations.

## The Wizard (interactive)

`src/import/tui/WizardApp.tsx` is the TTY counterpart to the headless orchestrator. State transitions live in `wizard-state-transitions.ts`; the step components are in `src/import/tui/steps/`. Hosts (`scope-gate-host.tsx`, `final-review-host.tsx`) bridge step UIs to underlying pipeline DB reads/writes. `spawn-generate.ts` runs `generate components` in parallel with the credentials step so the operator does not wait on the agent. `runLivePreview.ts` re-runs the diff after each FieldEditor save (disable with `--no-live-preview`).

Auto-filter resolution lives in `src/import/auto-filter-resolve.ts`: `--auto-filter` / `--no-auto-filter` flag wins over the `autoFilter` value persisted in `credentials.json`. The wizard writes the operator's last choice back to `credentials.json` so subsequent runs default to it.

## TUI Components

All TUI components are standard React functional components rendered by Ink. They live in:

- `src/analyze/tui/` — single `AnalyzeView` component
- `src/analyze/select/tui/` — full standalone JsonEditor (`App`, hooks, 10+ components); shared by `validate` and other commands that need `TopBar`/`useImmediateInput`. **Untouched by the wizard rebuild** — pinned by `test/analyze/select-flags.test.ts` snapshot for backwards-compat.
- `src/generate/tui/` — single `GenerateView` component
- `src/print/tui/` — `ValidateView` for `print validate`
- `src/apply/tui/` — `SummaryView`, `EntityDiffView`, `SelectView`, `ApplyView`
- `src/import/tui/` — the wizard: `WizardApp`, hosts (`scope-gate-host`, `final-review-host`), and step components in `steps/` (`WelcomeStep`, `CredentialsStep`, `ScopeGateStep`, `GenerateReviewStep`, `WizardPreviewStep`, `PreviewValidationErrorStep`, `PushDecisionGateStep`, `PushingStep`, `DoneStep`, `ErrorStep`, etc.)

When writing TUI tests, use `ink-testing-library`. Set `NO_COLOR=1` in the environment before running tests to suppress ANSI escape codes. Strip ANSI before snapshot assertions if the test renders raw strings.

Terminal width thresholds for `analyze edit`:
- 60 columns — minimum to launch
- 80 columns — full sidebar + detail
- 120 columns — source panel visible

## Session Persistence

**Pipeline sessions** (analyze, generate, edit) are in `pipeline.db` as described above. Override with `EDS_PIPELINE_DB_PATH`.

**Apply sessions** (push resumption) are in `~/.contentful/experience-design-system-cli/import.db`. Tests should set `EDS_IMPORT_DB_PATH` to a temp file to avoid polluting the developer's real DB.

**Review (analyze select) session files** are written to `~/.contentful/experience-design-system-cli/reviews/<sessionId>/current-review-state.json`. The session directory is keyed directly by session ID — not by a hash of an input file path. Both `analyze select` (TUI) and `analyze select-agent` (agentic) write to this same format.

## Testing

- Tests live in `test/` mirroring `src/`
- Vitest, no Jest
- CLI integration tests require `dist/` to exist — the test setup compiles if missing
- Snapshot files are committed; update with `--update-snapshots`
- Tests that call `analyze extract` or `generate components` must set `EDS_PIPELINE_DB_PATH` to an isolated temp path

## Commit Convention

Conventional Commits are enforced by a pre-commit hook:

```
type(scope): description
```

Valid types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, `build`, `revert`

## Sharp Edges

- **DOM prop inflation**: The single most common source of bugs in the React extractor. Always verify extracted prop counts after changing extraction logic. `Button` should have ~32 props, `Input` ~28, SVG icon components ~11.
- **No intermediary JSON files**: `analyze extract` does not write `raw-components.json`. `generate components` reads from the session DB. If you see file-based handoffs, they are wrong.
- **Session auto-resolution**: Commands that accept `--session` will auto-resolve to the most recent completed `analyze extract` step if the flag is omitted. Tests must always pass an explicit `--session` or set `EDS_PIPELINE_DB_PATH` to a seeded temp DB.
- **Stacked PRs and Nx affected**: When a base branch is merged to main before the stacked branch, `pnpm affected:*` may report "no packages changed" because `NX_BASE` points to the merged tip. This is expected — not a test failure.
- **ESM import paths**: TypeScript source imports `.js` extensions. Do not change them to `.ts`. The TypeScript compiler resolves them correctly.
- **Pre-commit hook failures**: If `lint-staged` or `commitlint` fails, fix the issue and re-commit. Never use `--no-verify`. The pre-commit hook runs `lint:fix` with `--skip-nx-cache` so formatting errors are always caught.

## Architecture Decisions

All significant technical decisions are documented in `docs/adr/`. Read the relevant ADR before changing:

- CLI build output path → `2026-04-22-cli-package-build-output-path.md`
- Why `typescript` is a runtime dep → `2026-04-22-typescript-as-runtime-dependency.md`
- DOM prop allowlist strategy → `2026-04-22-dom-attribute-prop-surfacing-strategy.md`
- SVGProps handling → `2026-04-22-svgprops-as-expandable-dom-wrapper.md`
- Directory structure rationale → `2026-04-22-domain-driven-cli-directory-structure.md`
- Why TUI instead of web UI → `2026-04-22-terminal-tui-over-web-ui.md`
- Generate subcommands replacing `--skill` flag → `2026-05-02-generate-subcommands-replace-skill-flag.md`
- Unified pipeline session in SQLite → `2026-05-02-unified-pipeline-session-sqlite.md`
- `apply` rename and non-interactive flags → `2026-05-03-apply-command-rename-and-non-interactive-flags.md`
- `import` as pipeline orchestrator → `2026-05-03-import-as-pipeline-orchestrator.md`
- Intermediary data in SQLite (no JSON files) → `2026-05-03-pipeline-intermediary-data-in-sqlite.md`

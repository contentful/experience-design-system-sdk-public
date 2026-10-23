# Agent Guide

This file tells AI coding agents what they need to know to be productive in this repo. Read it before making changes.

## Local commits

Commit completed implementation changes after the applicable repository checks pass, without waiting for a separate commit request. Stage only changes owned by the current work and use conventional commit messages. Remote publication still requires explicit approval.

## Repo at a Glance

Nx monorepo with four packages:

- `packages/experience-design-system-cli` — the published CLI (`@contentful/experience-design-system-cli`, bins `experiences`, `exo`, `experience-design-system-cli`) and the interactive import wizard
- `packages/experience-design-system-backend-pipeline` — extraction orchestration, generation, session persistence, in-process validation, and apply operations called directly by the wizard
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

`packages/experience-design-system-backend-pipeline/src/steps/extraction/src/framework-adapters/react/extractor.ts` is the most complex file (~2500 lines). Before editing it:

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
- `packages/experience-design-system-backend-pipeline/src/agents/skills/` is the source of the skill files copied into `packages/experience-design-system-cli/skills/` by the CLI `copy-assets` target
- Matching fallback skill copies live under `packages/experience-design-system-backend-pipeline/src/agents/skills/`; the CLI passes its packaged skill paths to backend generation. Backend skill lookup checks the actual file in the primary CLI layout (flat generation/selection plus `explore/` and `consensus/`) and grouped fallback layout. Exploration prepares all stage skill content before invoking an agent, so missing reconciliation assets fail during preparation.

Generated data stays in the backend session database until the CLI review and save flow. Generated component and token data are validated within the import path; generation agents use the pre-emit output checklist and warning rules rather than a separate CLI validation route.

Raw components are loaded from the session DB and embedded as an inline JSON block in the logical prompt. `PromptOptions.rawComponentsInline` carries this string; `rawComponentsPath` does not exist. Oversized Codex turns use a private temporary artifact of the complete prompt so the subprocess can inspect immutable supplied evidence without exceeding its initial-turn input limit; this is transport, not a file-based handoff between pipeline stages. Both local runners share this behavior and clean the artifact only after the subprocess settles.

Exploration, reconciliation and verification summarize routine compiler-read diagnostics and group source exclusions. Full diagnostics remain saved, and an invocation-scoped private JSON audit preserves exact receipts for read-only inspection. Coverage, configuration warnings, resolution outcomes, notable read failures and changed bindings stay visible; unknown diagnostics stay inline. The audit remains available until the invocation settles and is cleaned on every exit path.

Exploration scopes, detailed inventories, reconciliation, verification, independent checks and generated-model exploration supply a canonical draft-validation command using the same parser and source checks as host admission. Agents can inspect diagnostics and repair within their current conversation before returning the exact draft. Schema diagnostics retain machine paths and name the actual component/property/slot; component coverage errors list missing and unexpected identities. Host validation remains mandatory and authoritative.

Each exploration work unit prepares its full context and immutable validation evidence once and retains them across outer attempts until success, exhaustion or cancellation. Codex starts with JSON event output, captures its exact conversation UUID, and retries with `codex exec resume <UUID>` plus focused feedback and the persistent context/validator references. Never use `--last`, share conversations across work units, or feed transport events to decision parsers. Other transports retain fresh invocation behavior with the previous rejected draft and persistent context references. Debug events record conversation identity and whether an invocation resumes. These are operation-local repair resources, not saved-run continuation.

The output protocol for component and token generation: the agent emits one JSON tool-call object per line to stdout. The backend pipeline parses these lines in `packages/experience-design-system-backend-pipeline/src/agents/parsers/parse-tool-calls.ts` and `parse-token-tool-calls.ts`.

Component generation prepends the exact host-owned decision inventory to every attempt; corrections put rejected/missing subjects before source context. Advisory props can omit retained source inputs, so they are not the completeness checklist. A slot covers a source input only through an explicit accepted source-input association; matching names alone do not establish ownership. Every `classify_prop` requires a semantic category, including unresolved representations with no `cdf_type`; missing categories remain invalid. Prompt-only repairs can be checked through builds and static checks without running a live agent evaluation.

Generation decides authorability before selecting a representation. Verified complete implementation evidence may justify a reasoned exclusion for an input that is neither read nor forwarded, even with an unknown declared type. Unknown type, absent use records, partial excerpts or missing representation support alone never justify exclusion. Missing/parser-rejected subjects have no frozen semantic decision and may be reconsidered; accepted pending classifications retain their semantics during representation repair. Parser diagnostics identify the subject and offending representation companions, including `required` on unresolved drafts. Verify guidance changes through builds, typechecks and lint; live agent evaluations remain separate.

An explicit `exclude_prop` still requires a current source snapshot and verified declaration ranges, but it does not require a complete editable type shape or resolved type/default dependencies. Represented properties retain full graph coverage and binding checks; an unknown type alone never creates an exclusion.

Generation receives current, component-scoped exploration consensus, independently checked judgments, disagreements, hypotheses and modeling notes as advisory evidence. Reuse compatible judgments and explain departures; these records never overwrite source facts, narrow an open domain, change accepted source-owned slots or bypass property validation. The handoff checks the completed detail run, parent component run, source envelope and human scope before building the prompt; current-run checks still execute before decisions are applied.

Both generation entrypoints enable canonical representation validation through `generateCompleteDecisions`. The agent receives structured per-property feedback and may run only the exact supplied read-only draft validator against immutable invocation evidence; live source reads and execution remain forbidden. Up to five attempts share one deadline, successful decisions remain fixed, and only missing decisions or pending representation metadata may be repaired. Unresolved properties retain semantic decisions and concrete reasons without invalid representation companions; `complete` accounts for the inventory, while `representationsComplete` reports local admission. Held-result review routing remains separate and may still block generation.

Generation scopes inline evidence to one component and its source graph, owner implementation and exploration judgments. Complete original context, dependencies, observations and diagnostics remain in private invocation artifacts for targeted inspection. Supplied native/model decision skeletons preserve exact structural metadata without choosing authorability or category. The agent must validate its exact final JSON with the supplied command; host admission matches its normalized decisions to an invocation-local successful preflight receipt and independently validates the result. Correction validators include accepted decisions, protect pending semantics and validate only the requested repairs. Retrying resends focused subjects and accepted-decision summaries; repeated failures switch to evidence investigation and then source-compatible alternatives. Attempt sizes, elapsed time, strategy, repeated errors and receipt status are retained in debug records. Artifacts are disposed only after invocations settle; this is not persistent result caching.

Structured inputs may select a supplied compiler-derived `component-model` candidate through `classify_prop.representation_selection`, with its exact candidate ID, source revision and root node. This replaces a native `cdf_type`; it does not authorize invented `classify_slot` subjects. The host derives and validates model definitions, attachment slots and mappings, persists the selected plan atomically with generation decisions, and retains the plan through review/export. Recursive references link existing model definitions rather than truncating the source tree. Complete local model definitions can finish generation while deployment/rendering prerequisites remain explicit and separate; missing source coverage or held mappings still block completion.

Structured-property modeling follows [the general modeling rules](docs/structured-property-modeling.md). Prefer complete native Record/Array representations; create models for independently editable data. The host compacts single-value optional unions, transparent single-field object envelopes and singleton collection wrappers into explicit reconstruction mappings and ordered slots. Every logical source node, default and presence distinction remains accounted for. Preserve nullable/empty array element boundaries, nested collection grouping, real union branches and structural-only recursion; component counts never come from source names or framework recipes.

Selected model definitions appear as actual Components in generation review with source-derived display labels. Their stable review identities include the source owner, property and logical node; edits persist through the owner's selected plan and refresh the entire model family. Accepting a model includes its owner and dependency closure, and finalization requires acceptance of every generated dependency. Selected exports and import payloads include those definitions; model rows are not fabricated source candidates. Only slot edges matching validated model bindings are omitted from visual cycle detection, so recursive data models remain reviewable while ordinary composition cycles retain their checks.

Compiler configuration lookup searches bounded ancestors above the selected source root without widening discovery or component scope. Exact config/extends/reference bytes requested by the compiler are carried into capture, including package JSON configuration snapshots; standalone capture without those snapshots retains its inherited package-extends limitation. Nullability records present/absent/unknown separately for null and undefined: enabled strict checking can prove absence, direct syntax or alias evidence can prove presence, and compiler-erased or unresolved absence stays unknown.

Accepted source slots that retain their original input name can receive their source-input identity from verified compiler declarations, parameter bindings and positive returned-output witnesses during publication and reopen. This binds an existing accepted slot; it does not infer slot authorability or restrictions from a name or framework. Explicit associations and human decisions are preserved, and ambiguous or unbound inputs remain unassociated. Input/output evidence binds to the component declaration and its own captured locations; unavailable unrelated closure nodes do not invalidate that local identity. Unresolved property calls omit `required` as well as other representation metadata; original requiredness stays in source evidence.

The output protocol for the selection agent: the agent emits exactly one JSON object on a single line — either `{"tool":"select_component",...}` or `{"tool":"reject_component",...}`. The backend pipeline parses it in `packages/experience-design-system-backend-pipeline/src/agents/parsers/parse-select-tool-calls.ts`.

**Do not use agent SDKs or APIs** — the import wizard invokes agents as subprocesses only. This is a firm constraint.

New model dependencies selected during generation run a single Component-scoped exploration pass before the owner is completed. Reuse saved source and owner exploration judgments; require readable names, descriptions and exact per-field/slot accounting. Store validated reports in the signed plan. Only proven required, nonnullable singleton fields may leave the editor through fixed-value reconstruction; uncertain fields remain visible. Debug resume upgrades saved owners missing model reports without rerunning owner generation. This uses existing exploration infrastructure and does not restart the project consensus stages.

## The Selection Agent

`packages/experience-design-system-cli/src/tui/import/steps/06-extraction/selection.ts` runs during extraction after the backend pipeline creates a session. It makes one agent call for undecided components to decide whether each belongs in Contentful ExO as a Component Type. The decisions feed the scope gate (`steps/07-scope-gate`), where the operator confirms or changes them.

- Skips components whose decision is cached (keyed on the component, the prompt and the CLI version); `--no-cache` asks again for everything
- Times out after 5 minutes (`EDS_AGENT_TIMEOUT_MS`), and writes nothing if the call fails
- Stores accept and reject decisions, with rationale, in the pipeline DB (`raw_components.reject_reason`)
- `--prompt select=<file-or-text>` overrides its prompt

**Selection criteria**: accept any component that renders visible UI — atoms, molecules, and organisms are all valid Component Types in ExO. Reject only: React hooks, pure context providers, A/B testing or variant-routing wrappers (whose _entire_ purpose is routing), analytics trackers, security utilities. A component is not rejected merely because it has few props, is low-level, or contains some personalization-related props.

The skill file `packages/experience-design-system-backend-pipeline/src/agents/skills/select-components.md` provides detailed instructions and examples. The backend pipeline owns prompt assembly and agent invocation.

## The Import Apply Flow

The CLI's `steps/10-flow/` owns saving, preview, confirmation, and push inside the import wizard; there is no separate apply command. The save stage builds and validates the combined CDF. Backend-pipeline apply operations use `ImportApiClient` for preview, apply, and operation polling. Breaking-change acknowledgement is sent as an operation option; entities absent from the manifest are skipped.

## The Wizard (interactive)

`packages/experience-design-system-cli/src/tui/import/steps/` owns the interactive import wizard. There is no headless mode: `experiences import` requires an interactive terminal. The CLI owns screen and step routing and calls backend-pipeline functions directly for extraction, generation, session access, validation, and apply operations. Coding-agent work runs as a subprocess of the backend pipeline.

## TUI Components

All TUI components are standard React functional components rendered by Ink. They live in:

- `packages/experience-design-system-cli/src/tui/import/steps/` — import, review, preview, and push screens
- `packages/experience-design-system-cli/src/tui/` — CLI TUI components and shared terminal UI

Colors come from the shared `PALETTE` in `packages/experience-design-system-cli/src/tui/theme.ts`, imported as `@tui/theme.js` (the `@tui/*` alias maps to `src/tui/*`; it is set in `tsconfig.json` and `vitest.config.ts`). Do not hardcode colours or define another palette. Control hints use `ControlHints` and the import's step tabs use `StepHeader`, both in `src/tui/shared/components/`.

When writing TUI tests, use `ink-testing-library`. Set `NO_COLOR=1` in the environment before running tests to suppress ANSI escape codes. Strip ANSI before snapshot assertions if the test renders raw strings.

The scope gate (`steps/07-scope-gate`) shows two columns at 100 or more terminal columns (`columns.ts`) and one column below that.

## Session Persistence

**Pipeline sessions** (extraction, internal generation, review) are in `pipeline.db` as described above. Override with `EDS_PIPELINE_DB_PATH`.

### Component exploration cache

- Normal imports automatically reuse completed `components-1` through `components-7` responses across fresh source sessions; no resume flag or saved-source route is needed.
- Each response is saved after current parsing, assigned-component/source checks, source-input ownership checks and scope-report persistence, independently of later scope or phase failures.
- Keys hash source bytes and evidence, coverage/omissions, component/slot candidates, full compiler diagnostics, bundled rules/skill, renderer content, existing-entity context, agent/model and Bedrock mode. Session/run/capture identity, source-closure capture-binding identity, renderer retrieval time and discovery timing do not define task identity; current source binding remains required.
- Reused output is checksum-checked and reparsed; reports and accepted decisions are written under the current run and ownership/publication validation still executes. Separate cache-hit records retain original run provenance without pretending to invoke an agent again.
- `--no-cache` bypasses reads and still saves new successful responses. Unknown/default-auto models cannot reuse responses; set a model in settings or with `--agent agent:model`. Unfingerprinted historical reports require one fresh pass.
- Import-owned `.contentful` output is excluded from source discovery so debug logs, entity snapshots and generated import files do not change the next import's source evidence. Other generated source remains discoverable.
- Source extraction/composition and component generation continue to run fresh; detail inventories and reconciliation/verification are outside this component-explorer cache. Bump the cache revision in `build-explore-cache-key.ts` when changed semantics require invalidating prior answers.

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

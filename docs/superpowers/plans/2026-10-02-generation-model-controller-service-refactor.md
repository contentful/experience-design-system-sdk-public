# Generation model-controller-service refactor

Status: Phase 6 complete; Phase 7 pending.

research_started_at: `2026-10-02T15:41:33Z`

Baseline: `b25554cd6bc87127c1b6622951e12ab72a11cfe7`

Branch: `codex/generation-mvc-architecture`

Scope classification: Large single-repository refactor with more than six
independently verifiable workstreams, a public package boundary, subprocess and
authentication behavior, and CLI consumers that must be migrated without
changing generation results.

## Decision gate

This document is an implementation plan, not an implementation. Review the
target boundary, endpoint contract, phase order, and compatibility policy before
starting Phase 1.

The proposed direction is to make generation an in-process library API with a
typed controller at the package boundary. The local agent CLI remains an
adapter. The CLI remains responsible for sessions, cache, batching, retries,
progress presentation, and persistence of tool calls.

## Objective

Reorganize `@contentful/experience-design-system-generation` so that models,
controller orchestration, domain services, and local-process adapters have
explicit ownership, while preserving the package's current behavior and
published root exports.

The refactor must preserve:

- The four supported stages: `components`, `tokens`, `select`, and
  `map-tokens`.
- Inline-only input delivery; agents do not read source files from paths.
- The four existing output protocols and their warning behavior.
- Agent binary resolution, model defaults, environment overrides, Bedrock
  routing, and agent-specific argument ordering.
- Large-prompt stdin delivery, timeout and signal behavior, stdout/stderr
  capture, debug events, authentication checks, and failure diagnostics.
- Prompt section ordering, source and sibling evidence, truncation markers,
  `usesNotShown`, deterministic DTCG candidate ordering, and `$token.kind`
  scoping.
- Custom skill path/content overrides and packaged `skills/` assets.
- Existing root-level exports unless a separate public API decision approves a
  deprecation or removal.

The refactor must not introduce an HTTP server, an agent SDK, a generic
dependency-injection framework, an intermediate JSON file handoff, or database
and CLI persistence into the generation package.

## Audit evidence

### Current package shape

The package currently has six source files, four packaged skill assets, and five
test files:

| Current path | Approximate size | Current mixed responsibilities | Planned ownership |
| --- | ---: | --- | --- |
| `src/agent-runner.ts` | 746 lines | Protocol models and parsers, agent configuration, Bedrock policy, argument construction, subprocess execution, stdin delivery, timeout handling, debug events, auth checks, failure diagnostics, and legacy sentinel parsing | `model/`, `services/agent-configuration-service.ts`, `services/protocol-parser-service.ts`, `services/agent-auth-service.ts`, `services/failure-diagnostics-service.ts`, and `adapters/local/local-agent-process.ts` |
| `src/prompt-builder.ts` | 451 lines | Prompt contracts, skill discovery, custom-file loading, fence-language inference, CDF filtering, DTCG flattening, source rendering, existing-entity rendering, and four autonomous preambles | `model/prompt.ts`, `services/skill-loader.ts`, `services/prompt-context-service.ts`, `services/prompt-service.ts`, and `services/preambles/` |
| `src/agent-invoker.ts` | 40 lines | Agent-invoker port and local subprocess adapter factory in one file | `services/ports/agent-invoker.ts` and `adapters/local/local-agent-invoker.ts` |
| `src/agent-names.ts` | 9 lines | Agent identity values and type guard | `model/agent.ts` |
| `src/progress.ts` | 11 lines | CLI-facing progress-line serialization | `model/progress.ts` plus `services/progress-service.ts` |
| `src/index.ts` | 51 lines | Public barrel for contracts and implementation details | Explicit stable public barrel with compatibility re-exports |
| `skills/*.md` | 4 assets | Agent policy and output instructions | Retained as package assets; loaded through `SkillLoader` |

The tests are concentrated in `test/agent-runner.test.ts` (1,019 lines) and
`test/prompt-builder.test.ts` (597 lines). Their coverage is valuable, but the
file layout currently hides which tests protect parsing, configuration,
transport, prompt rendering, and skill packaging independently.

### Current agent-runner ownership map

`agent-runner.ts` contains these seams:

1. Tool-call contracts for component, token, selection, and map-token stages.
2. A shared JSON-object reader that skips prose and records malformed-line
   warnings.
3. Stage-specific parsers with different malformed-input behavior.
4. Agent binary names and `EDS_AGENT_BINARY_*` overrides.
5. Supported-agent and Bedrock capability policy.
6. Default model, explicit model, and `EDS_AGENT_MODEL_*` resolution.
7. Agent-specific argv construction, including Copilot `Auto` semantics.
8. Child-process execution, prompt stdin behavior, and Bedrock environment
   injection.
9. Timeout, signal, output capture, and debug-event behavior.
10. Binary existence and Claude authentication checks.
11. Failure-message construction.
12. `extractSentinelOutput`, which has no production call sites and is only
    exported and tested; it requires a public-compatibility decision before
    removal.

### Current prompt-builder ownership map

`prompt-builder.ts` contains these seams:

1. `Skill`, `Mode`, `PromptOptions`, `ComponentSourceRef`, and `GeneratedCdf`
   contracts.
2. Skill asset names and source/dist-relative asset discovery.
3. Bundled and custom skill loading with stable error messages.
4. Custom prompt warning-banner formatting.
5. Source filename to fenced-code-language mapping.
6. Design-token CDF filtering and `$token.kind` discovery.
7. DTCG flattening, sorting, and candidate-section rendering.
8. Existing component/token summaries and raw input sections.
9. Main source, sibling source, truncation, and `usesNotShown` evidence.
10. Four large stage-specific autonomous preambles.
11. Final prompt assembly and skill-instruction concatenation.

### Downstream consumers

The package is consumed by more than the internal generate command. The plan
must preserve or deliberately migrate each of these callers:

| Consumer | Current dependency | Migration responsibility |
| --- | --- | --- |
| `packages/experience-design-system-cli/src/generate/command.ts` | Direct prompt building, local invoker creation, parser calls, binary and skill resolution, failure diagnostics, progress formatting, and CLI-owned cache/DB/concurrency | Use the generation controller for one stage invocation; retain session persistence, batching, retries, cache, output, and application of parsed calls in the CLI |
| `packages/experience-design-system-cli/src/map-tokens/command.ts` | Direct prompt building, local invoker, map-token parser, binary and skill resolution, and failure diagnostics | Use the typed map-token controller path; retain token-session reads/writes and CLI presentation |
| `packages/experience-design-system-cli/src/analyze/extract-endpoint.ts` | Direct `runAgent` call for composition resolution plus agent identity and Bedrock policy | Migrate the subprocess call to the invoker port/local adapter or a generic invocation service; do not force composition into a generation-skill protocol |
| `packages/experience-design-system-cli/src/lib/agent-output.ts` | `AgentInvoker` and invocation options | Keep as a CLI output decorator over the package port, or replace with the controller's output callback without moving formatting into the package |
| `packages/experience-design-system-cli/src/session/db.ts` | `ToolCall`, `ComponentSourceRef`, and dynamic skill-path lookup | Continue using stable root exports; do not move persistence into generation |
| `packages/experience-design-system-cli/src/session/cache-keys.ts` | `Skill` and `resolveSkillPath` | Preserve a stable skill-asset lookup export and keep cache hashing in the CLI |
| Setup/import and agent-option modules | `AgentName`, `AGENT_NAMES`, `isAgentName`, `agentSupportsBedrock`, and `checkAgentAuth` | Preserve stable agent/configuration contracts and migrate only if the new root API is clearer |
| CLI tests and package mocks | Root-package exports and parsed-call shapes | Update mocks and add endpoint contract coverage without changing session or output semantics |

## Target architecture

```text
published root entrypoint (`src/index.ts`)
                    |
                    v
       controller/generate-endpoint.ts
       validates stage and composes one run
          |              |              |
          v              v              v
   prompt service   agent invoker port  protocol parser
          |              |              |
          v              v              v
   skill/context    local invoker       stage parsers
   preambles        adapter             + warning policy
                         |
                         v
                 local agent process
                 (spawn/stdin/env/timeouts)

models are shared contracts only and depend on neither Node process APIs nor CLI/session code
```

### Model layer

Create a package-internal `src/generate/model/` containing plain-data contracts:

- `agent.ts`: agent names, defaults, capability types, and identity guards.
- `invocation.ts`: agent execution request/result, debug-event type, auth
  status, timeout and prompt-delivery options.
- `protocol.ts`: component, token, select, and map-token calls; parsed result
  unions; warning shape; and any protocol discriminator.
- `prompt.ts`: skill/mode, prompt input, source-reference, generated-CDF, and
  prompt-output contracts.
- `progress.ts`: the stable progress event/line contract.
- `endpoint.ts`: the stage-discriminated request and response contract for the
  in-process generation endpoint.

Models must not import `node:child_process`, `node:fs`, CLI session modules, or
concrete adapter implementations.

### Controller layer

Create `src/generate/controller/generate-endpoint.ts` as the package's typed
application boundary. It should:

- Accept one stage-specific request containing prompt context and agent
  execution options.
- Validate the supported stage and required stage inputs before side effects.
- Ask the prompt service to build the complete inline prompt.
- Invoke the injected `AgentInvoker` port.
- Map the stage to the correct protocol parser.
- Return parsed calls, warnings, and raw run metadata in a discriminated result.
- Preserve timeout, non-zero-exit, empty-output, and no-tool-call distinctions so
  the CLI can retain its current retry and error policy.
- Support a prompt-only/dry-run path without spawning an agent.

The controller must not open a database, scan a project, apply tool calls,
manage cache entries, decide component concurrency, print terminal output, or
write files.

The contract should be finalized in Phase 1. The intended shape is:

```ts
type GenerateEndpointRequest =
  | { stage: 'components'; prompt: PromptOptions; invocation: AgentInvocationOptions }
  | { stage: 'tokens'; prompt: PromptOptions; invocation: AgentInvocationOptions }
  | { stage: 'select'; prompt: PromptOptions; invocation: AgentInvocationOptions }
  | { stage: 'map-tokens'; prompt: PromptOptions; invocation: AgentInvocationOptions };

type GenerateEndpointResponse =
  | { stage: 'components'; run: AgentRunResult; calls: ToolCall[]; warnings: string[] }
  | { stage: 'tokens'; run: AgentRunResult; calls: TokenToolCall[]; warnings: string[] }
  | { stage: 'select'; run: AgentRunResult; calls: SelectToolCall[]; warnings: string[] }
  | { stage: 'map-tokens'; run: AgentRunResult; calls: MapTokenPropCall[]; warnings: string[] };
```

The exact error/result representation may use a typed success/failure union,
but it must not collapse timeout, process exit, parser warnings, or empty calls
into an undifferentiated exception.

### Service layer

Create cohesive services with explicit constructor or factory dependencies:

- `agent-configuration-service.ts`: binary, model, Bedrock capability, Bedrock
  environment, and per-agent argv policy.
- `agent-auth-service.ts`: binary discovery and agent authentication checks.
- `protocol-parser-service.ts`: shared JSON-object framing plus the four stage
  parsers and their warning policies.
- `failure-diagnostics-service.ts`: stable failure descriptions from run
  metadata, stderr, and stdout.
- `skill-loader.ts`: bundled/custom skill resolution, file loading, and stable
  missing-file errors.
- `prompt-context-service.ts`: code-fence inference, raw/existing data
  sections, source/sibling evidence, truncation notices, generated-CDF token
  filtering, DTCG flattening, sorting, and candidate scoping.
- `prompt-service.ts`: ordered prompt assembly, custom-prompt warning banner,
  stage preamble selection, and skill-instruction concatenation.
- `progress-service.ts`: progress serialization only; terminal rendering stays
  in the CLI.
- `ports/agent-invoker.ts`: the transport-neutral `AgentInvoker` interface and
  invocation options.

Keep preambles as separate policy modules under
`src/generate/services/preambles/`:

- `components.ts`
- `tokens.ts`
- `select.ts`
- `map-tokens.ts`

Each preamble module must remain a pure renderer. It must not read files,
invoke agents, or know about SQLite.

### Adapter layer

Create `src/generate/adapters/local/`:

- `local-agent-invoker.ts`: implements the `AgentInvoker` port and preserves
  `createLocalCliAgentInvoker` as the public factory.
- `local-agent-process.ts`: owns `spawn`, argv construction, stdin delivery,
  Bedrock environment injection, stdout/stderr capture, timeout termination,
  and close/signal normalization.

The local adapter is the only layer that knows the agent is a subprocess. A
future non-local adapter can implement the port without importing prompt or CLI
session code.

### Packaged skill assets

Keep these files at the package `skills/` root because `package.json` publishes
that directory:

- `skills/generate-components.md`
- `skills/generate-tokens.md`
- `skills/select-components.md`
- `skills/map-tokens.md`

The loader may move its implementation, but the asset paths and published
package contents must remain stable. Skill content is policy data, not
TypeScript model or controller code.

## Ordered implementation phases

Every implementation phase follows red-green testing: add or adjust a focused
test, run it to establish the expected failure where behavior changes, make the
smallest implementation change, then refactor while keeping the focused and
regression suites green.

### Phase 1 — Freeze behavior and finalize the public contract

Status: Complete.

Files:

- Add `packages/experience-design-system-generation/test/public-api.test.ts`.
- Split only test helpers at this stage if needed; do not move production files
  yet.
- Update existing `agent-runner.test.ts`, `prompt-builder.test.ts`, and
  `skills.test.ts` only to name the behavior being frozen.

Work:

- Inventory every root export from `src/index.ts` and classify it as stable
  contract, supported integration API, or compatibility helper.
- Capture the exact serialized call shapes and warning strings for all four
  parsers, including malformed JSON, prose, unknown tools, missing fields,
  trailing content, and stage-specific skip behavior.
- Capture the exact agent argument arrays, model precedence, Copilot `Auto`
  behavior, Bedrock routing, stdin-vs-argv behavior, and auth statuses.
- Capture prompt section order and every evidence marker from the current
  prompt tests.
- Define the endpoint success/failure contract and dependency injection seam.
- Decide whether `extractSentinelOutput` remains a compatibility export. The
  default recommendation is to retain it as a deprecated compatibility helper
  until public-consumer evidence supports removal.
- Record the endpoint contract in this plan; add executable controller contract
  tests in Phase 6 when the controller implementation and injected ports exist.

Verification:

- Package tests, typecheck, and lint pass without production behavior changes.
- Root import smoke tests confirm every retained symbol is available from the
  package entrypoint.
- The endpoint contract is specified here and is covered by executable tests in
  Phase 6 rather than leaving a deliberately failing test in this phase.

Completed verification: the generation package build, typecheck, and lint
passed; the package test suite passed with 6 test files and 182 tests. The
phase added only root API characterization coverage and did not change
production implementation files.

### Phase 2 — Establish model and port boundaries

Status: Complete.

Files:

- Add `src/generate/model/agent.ts`.
- Add `src/generate/model/invocation.ts`.
- Add `src/generate/model/protocol.ts`.
- Add `src/generate/model/prompt.ts`.
- Add `src/generate/model/progress.ts`.
- Add `src/generate/model/endpoint.ts`.
- Add `src/generate/services/ports/agent-invoker.ts`.
- Convert `src/agent-names.ts`, `src/agent-invoker.ts`, and the type sections
  of `src/agent-runner.ts` and `src/prompt-builder.ts` into compatibility
  re-exports or remove them after all internal imports are updated.
- Add `test/model-boundaries.test.ts` if a static import-boundary assertion is
  useful.

Work:

- Move interfaces and type aliases without changing field names, optionality,
  discriminators, or runtime serialization.
- Separate transport-neutral `AgentInvoker` contracts from the local factory.
- Keep root-level exports stable through `src/index.ts` while implementation
  imports use the new model paths.
- Ensure models have no Node or CLI imports.

Verification:

- Model modules compile and the model-layer import audit contains no Node or
  CLI dependencies.
- Package typecheck catches unused legacy exports and circular imports.
- Existing parser, prompt, and CLI consumer tests remain green.

Completed verification: the generation package build, typecheck, lint, and
tests passed with 6 test files and 182 tests. The CLI typecheck passed, and the
full CLI suite passed with 241 test files and 2,682 tests. The model layer has
no Node runtime imports, and the old root source files remain compatibility
facades while the new model and port modules own the contracts.

### Phase 3 — Split agent configuration, authentication, and local process execution

Status: Complete.

Files:

- Add `src/generate/services/agent-configuration-service.ts`.
- Add `src/generate/services/agent-auth-service.ts`.
- Add `src/generate/services/failure-diagnostics-service.ts`.
- Add `src/generate/adapters/local/local-agent-process.ts`.
- Add `src/generate/adapters/local/local-agent-invoker.ts`.
- Move or replace `src/agent-invoker.ts` and the invocation sections of
  `src/agent-runner.ts`.
- Add focused suites:
  `test/services/agent-configuration-service.test.ts`,
  `test/services/agent-auth-service.test.ts`,
  `test/services/failure-diagnostics-service.test.ts`, and
  `test/adapters/local/local-agent-process.test.ts`.
- Move `test/run-agent-stdin.test.ts` to the local adapter test location.
- Retain `test/agent-runner.test.ts` as compatibility coverage for parser and
  facade exports until the parser extraction in Phase 4.

Work:

- Preserve explicit model over environment override over default precedence.
- Preserve the absent default model for direct Codex use and the Bedrock-specific
  Codex/OpenCode fallback behavior.
- Preserve Claude, Codex, OpenCode, Cursor, and Copilot argv ordering,
  including Copilot prompt placement and `Auto` omission.
- Preserve `EDS_BEDROCK`, `EDS_AGENT_BINARY_*`,
  `EDS_AGENT_MODEL_*`, AWS-region fallback, and Claude-only auth probing.
- Preserve child `env` inheritance, EPIPE tolerance, timeout SIGTERM, signal
  exit normalization, output callbacks, and debug-event payloads.
- Keep the `AgentInvoker` port free of process-specific imports.

Verification:

- Focused configuration, auth, diagnostics, and local-process tests pass.
- The large-prompt test proves the prompt is delivered on stdin and not argv.
- No test requires a real agent binary or credentials.
- CLI composition and generation tests continue to receive the same invoker
  result shape.

Completed verification: the generation package build, typecheck, lint, and
tests passed with 10 test files and 192 tests. The CLI typecheck passed, and
the full CLI suite passed with 241 test files and 2,682 tests. Configuration,
authentication, diagnostics, and local subprocess ownership now live in their
dedicated service and adapter modules; the old `agent-runner.ts` and
`agent-invoker.ts` paths remain compatibility facades.

### Phase 4 — Isolate protocol parsers

Status: Complete.

Files:

- Add `src/generate/services/protocol-parser-service.ts`.
- Keep protocol types in `src/generate/model/protocol.ts`.
- Add focused tests:
  - `test/services/component-protocol-parser.test.ts`
  - `test/services/token-protocol-parser.test.ts`
  - `test/services/select-protocol-parser.test.ts`
  - `test/services/map-token-protocol-parser.test.ts`
  - `test/services/protocol-framing.test.ts`
- Retain `test/agent-runner.test.ts` temporarily only for compatibility smoke
  coverage, then remove it after all cases are relocated.

Work:

- Extract shared balanced-JSON framing from stage-specific validation.
- Preserve object ordering, prose skipping, trailing-content warnings, malformed
  line warnings, and unknown-tool handling.
- Preserve all optional-field filtering and validation, including CDF types,
  categories, confidence range, non-empty token paths, and token value presence.
- Keep parser services pure: no process execution, filesystem access, logging,
  database writes, or CLI output.

Verification:

- Focused parser suites pass with positive and negative cases for every current
  branch.
- CLI session application tests still accept the exact parsed call unions.
- Root exports point to the parser service without changing consumer imports.

Completed verification: the generation package build, typecheck, lint, and
tests passed with 15 test files and 202 tests; the CLI typecheck passed, and
the full CLI suite passed with 241 test files and 2,682 tests.

### Phase 5 — Decompose prompt loading, context rendering, and preambles

Status: Complete.

Files:

- Add `src/generate/services/skill-loader.ts`.
- Add `src/generate/services/prompt-context-service.ts`.
- Add `src/generate/services/prompt-service.ts`.
- Add `src/generate/services/preambles/components.ts`.
- Add `src/generate/services/preambles/tokens.ts`.
- Add `src/generate/services/preambles/select.ts`.
- Add `src/generate/services/preambles/map-tokens.ts`.
- Move prompt contracts to `src/generate/model/prompt.ts`.
- Replace `src/prompt-builder.ts` with compatibility re-exports only during the
  migration, then remove it when no internal source-path imports remain.
- Split `test/prompt-builder.test.ts` into:
  - `test/services/skill-loader.test.ts`
  - `test/services/prompt-context-service.test.ts`
  - `test/services/prompt-service.test.ts`
  - `test/services/preambles.test.ts`
- Keep `test/skills.test.ts` and extend it for package asset paths if needed.

Work:

- Keep bundled skill discovery working from both source and compiled `dist/src`
  locations.
- Keep custom path and inline content precedence, missing-file errors, and
  custom-prompt warning behavior.
- Preserve section order for existing entities, raw components, raw tokens,
  DTCG data, token sidecars, generated CDF, token indexes, and source evidence.
- Preserve deterministic DTCG path sorting and `$token.kind` scoping.
- Preserve code-fence language inference for all currently supported extensions
  and the `text` fallback.
- Preserve source/sibling content, truncation count, and `usesNotShown` wording.
- Keep the four preambles as independent pure policies so stage changes cannot
  silently alter another stage.
- Remove or explicitly document the currently unused `outDir` field instead of
  carrying an unexplained dependency into the new controller contract.

Verification:

- Prompt snapshots or exact-string tests pass for every current section and
  preamble.
- Tests cover omitted optional sections, missing source content, truncated
  siblings, unscoped token kinds, custom prompt overrides, and invalid skills.
- `skills/` packaging tests pass from both source and built output contexts.

Completed verification: the prompt behavior remained covered by the existing
regression suite plus focused service tests; generation typecheck and lint
passed, generation tests passed with 19 test files and 209 tests, the CLI
typecheck passed, and the full CLI suite passed with 241 test files and 2,682
tests. The prompt builder is now a compatibility facade over explicit skill,
context, preamble, and assembly services.

### Phase 6 — Implement the generation controller endpoint

Status: Complete.

Files:

- Add `src/generate/controller/generate-endpoint.ts`.
- Add `src/generate/controller/create-generate-endpoint.ts` only if factory
  composition is needed to keep dependency wiring out of the controller.
- Add or complete `src/generate/model/endpoint.ts`.
- Complete `test/controller/generate-endpoint.test.ts`.
- Add `test/controller/generate-endpoint-failure.test.ts` if success and failure
  unions are easier to audit separately.

Work:

- Inject the prompt service, `AgentInvoker`, protocol parser, and diagnostic
  service through explicit dependencies.
- Validate the stage/request relationship before invoking the agent.
- Build the prompt once, invoke once, parse with the stage-specific parser, and
  return raw run metadata plus typed calls and warnings.
- Provide prompt-only behavior for dry-run consumers without spawning a child.
- Keep process retries outside the endpoint so the controller represents one
  attempt and does not duplicate CLI policy.
- Keep the endpoint usable by a future non-local adapter.

Verification:

- Red-green controller tests prove dependency order and stage dispatch.
- A fake invoker proves no process is spawned in unit tests.
- Tests cover prompt failure, non-zero exit, timeout, empty calls, parser
  warnings, and successful parsed output for all four stages.
- Controller tests prove there is no database, filesystem scan, or CLI output.

Completed verification: controller tests passed with 21 generation test files
and 219 tests; generation typecheck and lint passed, the CLI typecheck passed,
and the endpoint factory and typed contracts are exported from the package
root. The endpoint returns prompt-only results for dry runs, preserves raw run
metadata and parsed warnings, and leaves retries and persistence to callers.

### Phase 7 — Migrate CLI consumers and retain compatibility exports

Files:

- Update `packages/experience-design-system-cli/src/generate/command.ts`.
- Update `packages/experience-design-system-cli/src/map-tokens/command.ts`.
- Update `packages/experience-design-system-cli/src/analyze/extract-endpoint.ts`
  to use the invoker/local adapter boundary for composition calls.
- Update `packages/experience-design-system-cli/src/lib/agent-output.ts` if the
  callback shape changes; keep output formatting in the CLI.
- Update `packages/experience-design-system-cli/src/session/db.ts` and
  `src/session/cache-keys.ts` only where new stable root names are required.
- Update setup/import agent consumers only if compatibility exports are not
  sufficient.
- Update CLI generation, map-token, composition, cache, wizard, session, and
  mock tests that import affected symbols.
- Update `src/index.ts` to expose the endpoint, model contracts, invoker port,
  local adapter factory, skill resolver, progress formatter, and compatibility
  helpers intentionally.

Work:

- Replace direct parser/prompt/process composition in the two generation
  commands with the endpoint.
- Keep CLI-level component concurrency, retries, cache lookup/write, pinned
  entries, SQLite application, progress output, and error presentation exactly
  where they are.
- Do not move `applyToolCalls`, `applyTokenToolCalls`, `applyMapTokenPropCalls`,
  or session ownership into the generation package.
- Keep composition's custom prompt path and generic stdout handling separate
  from the four generation-stage protocol parsers.
- Preserve root exports during the transition so external consumers do not need
  a synchronized release.

Verification:

- Generation cache integration tests pass with the same prompt hashes and skill
  asset contents.
- CLI tests pass for generated component calls, token calls, map-token calls,
  wizard auth checks, agent flags, composition resolution, retries, and cache
  hits.
- A repository-wide search finds no production import of the old implementation
  paths except intentional compatibility shims.

### Phase 8 — Remove obsolete implementation files and document the boundary

Files:

- Remove empty or superseded `src/agent-runner.ts`, `src/prompt-builder.ts`,
  `src/agent-invoker.ts`, `src/agent-names.ts`, and `src/progress.ts` only when
  their compatibility role is no longer needed.
- Update `src/index.ts` after each removal to keep exports explicit.
- Update `AGENTS.md` generation-package sections.
- Update `ARCHITECTURE.md` with the generation dependency diagram and CLI
  ownership boundary.
- Update `CONTRIBUTING.md` with package test and asset-packaging guidance if
  the new structure changes contributor workflow.
- Add `docs/decisions/0005-generation-model-controller-service-boundary.md` if
  the endpoint and dependency rules are accepted as a durable architecture
  invariant.

Work:

- Remove stale comments that describe the old root-file organization.
- Keep a compatibility re-export for any root symbol with a supported consumer.
- Do not remove `extractSentinelOutput` solely because this repository has no
  production caller; make that a documented public API decision.
- Confirm all package and CLI import paths use `.js` extensions and remain ESM.

Verification:

- `rg` finds no stale source-path imports or old ownership descriptions.
- Built declarations contain the intended public contract and no accidental
  Node-internal implementation types.
- The package tarball still includes `dist/` and all four `skills/` assets.

### Phase 9 — Full verification and release-readiness audit

Run in serial order because generated-code tasks can contend for workspace
artifacts:

```bash
pnpm exec nx run experience-design-system-generation:build
pnpm exec nx run experience-design-system-generation:typecheck
pnpm exec nx run experience-design-system-generation:lint
pnpm exec nx run experience-design-system-generation:test
pnpm exec nx run experience-design-system-cli:typecheck
pnpm exec nx run experience-design-system-cli:test --skip-nx-cache
```

Also run the focused CLI suites covering generation cache, internal generate,
map tokens, composition resolution, setup/import auth, and session tool-call
application. Confirm the CLI test environment uses an isolated pipeline DB.

Final checks:

- `git diff --check` is clean.
- Package build declarations expose only intentional public symbols.
- `pnpm pack --dry-run` or the repository-equivalent package inspection shows
  the four skill assets are published.
- No credentials, customer data, internal ticket identifiers, or private
  operational details appear in source, tests, comments, commit messages, or
  plan artifacts.
- All commits use conventional commit types and contain one cohesive concern.

## Dependency graph and parallelism

```text
Phase 1 contract characterization
          |
          v
Phase 2 models and ports
       /        \
      v          v
Phase 3      Phase 4
agent        protocol
runtime      parsers
       \        /
        v      v
      Phase 5 prompt services
              |
              v
      Phase 6 controller endpoint
              |
              v
      Phase 7 CLI migration
              |
              v
      Phase 8 cleanup and docs
              |
              v
      Phase 9 full verification
```

Phases 3 and 4 can proceed in parallel after Phase 2 if each keeps its tests
isolated. Phase 5 depends on the model contracts but can proceed in parallel
with the final parser cleanup. Phase 6 must wait for the service contracts.
Phases 7 through 9 are serial because they change the public integration
surface.

## Risk tiers

| Workstream | Risk | Reason | Required treatment |
| --- | --- | --- | --- |
| Model moves and test-file moves | Low | Structural if field shapes are unchanged | Typecheck and focused tests |
| Prompt service split | Medium | Ordering and evidence omissions can change model behavior | Exact-string/snapshot characterization and deterministic ordering tests |
| Protocol parser split | Medium | Warning and skip semantics feed persistence | Positive and negative parser contract tests |
| Local process adapter | High | Auth, Bedrock, stdin, timeout, signal, and argv behavior affect execution | Isolated fake-binary tests plus existing subprocess tests |
| Public root exports | High | External consumers may import currently exported helpers | Root API inventory, declaration check, compatibility shims, explicit decision before removal |
| Controller endpoint | High | New boundary becomes the package's supported integration contract | User review of endpoint contract and dependency injection seam |
| CLI migration | High | Cache, retries, DB writes, and user-visible errors must remain unchanged | CLI integration tests and staged migration with old exports available |
| Documentation and cleanup | Low | Does not alter runtime when synchronized with code | Repository-wide stale-path search and docs review |

## Compatibility strategy

1. Keep `src/index.ts` as the only supported package barrel and preserve all
   existing root names during the refactor.
2. Use compatibility re-exports while internal callers migrate; do not expose
   new deep import paths as a substitute for a public contract.
3. Keep `AgentRunResult`, parsed call shapes, `AgentInvoker`, prompt contracts,
   agent names, skill resolution, progress formatting, and auth statuses
   source-compatible.
4. Keep parser warning strings stable unless a behavior correction is separately
   approved and tested.
5. Keep skill asset filenames and published paths stable.
6. Keep local process behavior behind the same invoker contract so CLI output
   decorators and composition callers do not need to understand the new
   adapter layout.
7. Treat `extractSentinelOutput` as a public compatibility question, not an
   internal dead-code cleanup task.
8. Do not change prompt contents during file moves; prompt policy changes must
   be separate, reviewable commits with prompt tests.

## Commit strategy

Use one conventional commit per cohesive phase, with no behavior change hidden
inside a directory-only move:

1. `test(generation): characterize public generation contracts`
2. `refactor(generation): establish model and invoker boundaries`
3. `refactor(generation): separate local agent runtime services`
4. `refactor(generation): isolate generation protocol parsers`
5. `refactor(generation): organize prompt services and skill policies`
6. `feat(generation): add the in-process generation endpoint`
7. `refactor(cli): consume the generation endpoint`
8. `docs(generation): document model controller service boundaries`

If a phase is too large for one review, split it by the dependency graph and
retain green tests at each commit. Do not squash unrelated parser, transport,
prompt, and CLI changes merely because they touch the same package.

## Rollback and stop conditions

- Stop before changing the endpoint contract if the public root-export census
  finds external consumers that require a different shape.
- Stop before removing a compatibility file if declaration output or repository
  search finds an unsupported deep import or a public consumer not covered by
  tests.
- Stop if parser warnings, prompt ordering, tool-call shapes, or agent argv
  arrays differ without a separately approved behavior change.
- Stop if the controller requires SQLite, project scanning, terminal output, or
  CLI-specific retry/cache behavior; move that responsibility back to the CLI
  or revise the boundary before continuing.
- Stop if a local adapter test needs real credentials, a real agent binary, or
  network access; replace it with a deterministic fake process or port test.
- Roll back a phase by reverting its cohesive commit while leaving prior
  characterization tests and earlier completed phases intact.
- Update this plan before continuing if implementation reveals a cross-package
  contract not present in the audit.

## Completion criteria

- The package has explicit `model/`, `controller/`, `services/`, and
  `adapters/local/` ownership under `src/generate/`.
- The typed generation endpoint can run all four stages without CLI, database,
  or HTTP dependencies.
- A local subprocess adapter implements the invoker port and preserves all
  current execution semantics.
- Protocol parsing, prompt loading/rendering, agent configuration, auth,
  diagnostics, and progress each have an identifiable service owner.
- The CLI owns persistence, caching, batching, retries, rendering, and applying
  tool calls.
- Root exports, parsed result shapes, prompt content, skill assets, and agent
  process behavior remain compatible.
- Package and affected CLI tests, typecheck, lint, build, and packaging checks
  pass.
- Architecture documentation matches the checked-in directory structure.

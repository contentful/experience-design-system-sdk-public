# Architecture

## Overview

The Experience Design System SDK is an Nx monorepo with four packages:

| Package                                                 | Purpose                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `@contentful/experience-design-system-cli`              | Published CLI and interactive import wizard; owns user input, screens, and flow routing                       |
| `@contentful/experience-design-system-backend-pipeline` | In-process extraction, generation, session persistence, validation, and apply operations called by the wizard |
| `@contentful/experience-design-system-client`           | Generated API client used by backend apply operations                                                         |
| `@contentful/experience-design-system-types`            | Shared TypeScript types, Zod schemas, and CDF/DTCG validation logic                                           |

The supported user flow is the interactive `experiences import` wizard. The CLI calls backend-pipeline functions directly in the same process; the backend invokes the selected coding agent as a local subprocess where needed.

Source extraction, source-evidence capture, deterministic composition evidence, exploration session loading, and source prompt projection run in worker threads so synchronous compiler, validation, and filesystem work cannot block the terminal's timers or keyboard input. The backend owns this boundary in `src/source-analysis/`; each task transfers plain inputs, progress, and results. Cancellation terminates and joins its worker before the operation settles. Session loading uses a read-only SQLite connection and a consistent read transaction. Workers perform no database writes and launch no agents; all writes and coding-agent subprocess lifecycles remain in the orchestrating thread. Both the compiled backend and bundled CLI resolve the compiled worker artifact, which ships with the backend package.

Selecting a component subdirectory does not limit compiler configuration lookup to that directory: a bounded ancestor search finds the applicable parent configuration, while selected source roots remain unchanged. Compiler-requested configuration bytes and hashes travel as configuration snapshots into source capture; capture keeps them separate from source discovery and uses the compiler snapshot if the live configuration changes. Package-based config dependencies are captured only when supplied as exact compiler snapshots. Source graphs record null and undefined independently as present, absent or unknown with provenance; strict compiler evidence can establish absence, while erased or unresolved checker types do not establish absence. Direct syntax and type-alias evidence can preserve positive nullability facts.

Callable source observations include bounded, ordered field-flow evidence with separate value-independence, output-dependence and omission-safety findings. The evaluator follows initialized bindings, record construction and private writes, finite branches, and compiler-resolved helper bodies without recognizing component or field names. Findings are conditional on explicit ordinary-data and delivery premises; unknown effects, uncertain aliasing, unavailable bindings and exhausted bounds remain open. Source candidates are preserved, and neither conditional findings nor absent output dependencies authorize field deletion. Persisted evidence retains source locations and rejects unsupported semantic versions, changed root identity and claims promoted beyond their premises.

Field-flow evidence states its runtime alias and intrinsic assumptions: `ordinary-own-data-inputs` requires inert own data properties; `isolated-input-tree` requires no shared/cyclic input records or untracked external aliases; `standard-record-intrinsics` requires ordinary, unmodified record property operations. Type annotations do not establish these premises. Omission additionally requires `entry-delivery-admits-omission`. Decoding rejects conditional claims that contradict observed dependence, open coverage/obligations or their recorded reasons; coherent unknown findings remain valid evidence. This is an evidence-contract check, not semantic replay or proof activation.

Source field semantics version 6 and paired replay version 8 retain dense local arrays, exact own index/cardinality reads and shallow spreads. Bounded synchronous `for…of` follows those arrays with one immutable identifier binding per iteration, preserving element/record aliases across body branches and handling nested loops and early returns. Operations record their exact iteration paths; repeated helper invocations in different iterations have distinct frames. Iterable evaluation happens once, and all iterations and alternatives share finite node/operation/depth limits. Unknown iterables, sparse or mutated arrays, asynchronous iteration, mutable/destructured loop bindings, break/continue and unsupported callback effects remain unknown. The `standard-local-array-iteration` premise requires ordinary unmodified array iteration and is not established by static replay. Captured-source reproduction validates saved iteration evidence without executing customer code or reading live source; incompatible older evidence versions are rejected, and every source field remains retained.

Paired replay binds default-free object patterns in root parameters, locally invoked helper/callback parameters and initialized local declarations using compiler declaration identity. Aliased names and nested patterns preserve record identity across branches and captures rather than reconstructing values; object-pattern processing shares the finite node/depth and operation budgets. Exact locally evaluated computed keys can participate. Defaults, rest, array patterns, unavailable keys, opaque values and inherited reads on private records remain unknown, as do mutable local declarations and unsupported effects. Saved-source reproduction preserves these bindings without establishing runtime applicability or removing source fields.

Executed local callbacks retain the declaration-bound values available when their callable is resolved. Invocation reads those captures rather than substituting caller-local variables; branch copying preserves record aliases across callable captures and the surrounding scope. Capture construction and copying share the finite evaluation budget. Immutable captured bindings and reads of supported private records can participate in conditional comparisons, including callbacks passed to locally resolved helpers. Captured writes, mutable or not-yet-initialized bindings, escaping/returned callable values, asynchronous callbacks and opaque invocation remain unknown. These snapshots do not establish unrestricted closure semantics, library callback execution, runtime applicability or authoring-field removal.

Dense local arrays also support bounded `Array.prototype.map` with a locally resolved synchronous callback. Receiver and callback arguments are evaluated once, and callbacks receive the exact element, index and original array in order; nested mapping retains distinct iteration paths and invocation frames. The evaluator reuses local invocation, lexical capture, alias, effect and finite-budget rules. The `standard-local-array-map` premise requires ordinary unmodified method lookup, array construction/species and mapping intrinsics; source types do not establish it. Sparse/dynamic/mutated receivers, opaque or asynchronous callbacks, explicit `thisArg`, captured writes and compound callback returns remain open. Saved-source reproduction and the reasoning retention preview preserve this conditional evidence without authorizing schema changes.

The shared reasoning channel includes a bounded lexical closure projection. It joins each summary observation to its original source context and compiler symbol/declaration references, preserving the distinction between a referenced body and executed code. Supplied renderable, member, filter, parent, nonstatic and origin facts attach to the unique innermost observed lexical declaration whose source identity and range contain their location; unreachable nested owners remain unassigned rather than falling back to an enclosing component. Reachable owners follow summary witnesses with the existing uncertainty/provenance rules. Missing, changed, unavailable or unobserved locations remain unassigned with reasons; failed or unavailable closure source withholds joined claims. The projection references the retained raw facts, uses the existing observation limit for derived records, records omissions and never establishes runtime requirements or changes schemas. It is rebuilt from current-session saved facts for selection, generation and scoped exploration rather than persisting a second source of truth.

Validated paired replay adds a component-specific `fieldProjectionPreview` to the reasoning evidence channel. Each exact field path carries separate value and omission applicability, unestablished premises, and retained reasons. The preview is always `retention-only`: matched replay reproduces captured source, while runtime and delivery premises remain unestablished. Missing paired replay or unavailable component facts withhold the preview; mismatched or unavailable replay retains uncertainty. Source candidates, shared shapes, sibling components, and authoring schemas are not changed, and uncovered fields remain retained. Caller-provided preview metadata cannot override the derived assessment.

The shared extraction service preserves candidates returned by its framework readers without a second exclusion based on component names. A name resembling a hook does not establish rendering behavior. Reader discovery conventions and later authoring decisions remain separate stages, and unresolved behavior remains evidence for review.

---

## System Context

```
Design system codebase
  (React / Vue / Astro / Stencil / Web Components)
        │
        ▼
  experiences import (CLI TUI)
    ├── collects project, token, agent, and credential inputs
    ├── calls backend-pipeline extraction, generation, validation, and apply functions in-process
    ├── invokes the selected coding agent as a subprocess for agent-backed stages
    └── reviews and saves the generated CDF before preview and push
        │
        ▼
  Contentful ExO (component types + design tokens)
```

Component-analysis data between stages flows through a local SQLite session database (`~/.contentful/experience-design-system-cli/pipeline.db`). When a token source is supplied, the wizard starts token generation alongside extraction and selection, then maps tokens after component generation where eligible. The same import flow validates the saved CDF and handles preview and push; these are not separate CLI commands.

Raw prop definitions retain optional DOM-forwarding provenance in the session database: true, false, or unknown. Selection and component generation derive advisory prop buckets from that evidence, then omit the provenance flag from raw component data in agent prompts; the buckets are context rather than inclusion or category decisions.

With Debug Mode enabled, the CLI records `prop-buckets.select` and `prop-buckets.generate` events in `.contentful/<session>/debug/events.jsonl`, including the pipeline session ID. The backend accepts optional caller-owned event sinks; it does not own a log file. Generation waits for these diagnostic writes on success and failure, and disabled or failed debug logging does not stop the import.

A separate JSON file at `~/.contentful/experience-design-system-cli/state/runs.json` records each successful wizard session (id, project path, save path, push target, component count). No command lists these records.

When a token file is supplied (the token-input screen), the wizard starts token generation alongside extraction and selection. Token mapping runs after component generation and uses the generated CDF and DTCG data from their pipeline sessions.

---

## Packages

### `experience-design-system-cli`

The published package provides the `experiences`, `exo`, and `experience-design-system-cli` binaries. The CLI owns the Ink import wizard under `src/tui/import/`, registers the `import` route, and calls backend-pipeline operations directly. Its `copy-assets` target copies the backend's generation, selection, exploration and consensus skills into the published package for runtime prompt loading.

### `experience-design-system-backend-pipeline`

Owns extraction and composition orchestration, generation sessions, prompt assembly, session persistence, in-process validation, and apply operations. The CLI imports these functions instead of spawning hidden CLI commands. Matching skill files under `src/agents/skills/` provide fallback content for backend prompt loading.

The extraction engine under `src/steps/extraction/` owns modular framework adapters, compiler context and graphs, source capture and reference evidence, closure analysis, prop classification and quality review. These modules are part of the backend package. The same package owns all generation, selection, exploration and consensus skill sources; CLI build assets copy them from `src/agents/skills/`.

### `experience-design-system-client`

Generated TypeScript client for the Experience Design System Integrations API, generated from `openapi.json` via `@hey-api/openapi-ts`. Consumed by backend apply operations for preview and apply requests.

### `experience-design-system-types`

CDF and DTCG type definitions, JSON schemas, and validation utilities. Published as a separate package and consumed by the CLI and backend pipeline.

---

## Data Formats

### RawComponentDefinition (extraction output)

Produced by extraction, stored in the pipeline session database, consumed by the wizard's scope-gate and internal generation:

```typescript
interface RawComponentDefinition {
  name: string; // PascalCase component name
  source: string; // absolute path to source file
  framework: 'react' | 'next' | 'vue' | 'astro' | 'web-component' | 'stencil';
  props: RawPropDefinition[];
  slots: RawSlotDefinition[];
}

interface RawPropDefinition {
  name: string;
  type: string; // TypeScript type string
  required: boolean;
  category?: 'content' | 'design' | 'state';
  defaultValue?: string;
  allowedValues?: string[]; // for enum / union types
  description?: string;
  tokenReference?: string; // e.g. "color.brand.primary"
}

interface RawSlotDefinition {
  name: string;
  isDefault: boolean; // true = children slot
  description?: string;
  allowedComponents?: string[];
}
```

### CDF (Component Definition Format)

The finalized format for Contentful ExO import. Produced by backend generation and reviewed and saved by the import wizard:

```typescript
interface CDFFile {
  $schema: string;
  [key: string]: CDFGroupOrComponent | string | undefined;
}

interface CDFComponentEntry {
  $type: 'component';
  $description?: string;
  $properties: Record<string, CDFPropertyDefinition>;
  $slots?: Record<string, CDFSlotDefinition>;
}

interface CDFPropertyDefinition {
  $type: CDFPropertyType; // 'string' | 'richtext' | 'number' | 'media' | 'link' | 'token' | 'boolean'
  $category: CDFPropertyCategory; // 'content' | 'design' | 'state'
  $description?: string;
  $required?: boolean;
  $default?: unknown;
  $values?: string[];
  '$token.kind'?: string;
  '$token.allowed'?: string[]; // restricted DTCG paths; omitted for unrestricted token props
}
```

For design-category token properties, extraction stores the raw default in `raw_props.default_value` and does not rewrite it during mapping. `map tokens` resolves `tokenReference` when present, otherwise the raw default, to a canonical DTCG path when it is exact or has one token-kind-compatible normalized terminal-member match. It persists that source-reference-to-path association in `raw_token_name_paths`. When CDF is projected, that compatible path becomes `$default`; otherwise the raw extracted default is retained. The agentic part of the stage is separate: it may write reviewed-compatible DTCG paths to `$token.allowed`, while an empty or absent restriction leaves the property unrestricted.

### DTCG (W3C Design Token Format)

Design token files following the W3C DTCG spec. Produced by backend token generation and used by the import wizard's mapping and apply flow:

```typescript
interface DTCGTokenLeaf {
  $type: string;
  $value: unknown;
  $description?: string;
}

interface DTCGTokenGroupNode {
  $description?: string;
  [key: string]: DTCGTokenNode | string | undefined;
}
```

---

## Pipeline Session Database

All import stages share a single SQLite database at `~/.contentful/experience-design-system-cli/pipeline.db` (overridable via `EDS_PIPELINE_DB_PATH`). Legacy `import.db` data may be read once by session migration, but the current apply flow uses the sources API manifest operation rather than per-entity push resumption.

Database initialization also runs a one-time cleanup migration for obsolete step labels. It removes only `analyze select`, `print components`, `print tokens`, and `fetch existing entities` rows whose status is `pending`, `failed`, or `interrupted`; completed rows, retained workflow labels, unknown labels and statuses, sessions, and saved component/token data remain intact.

`DatabaseSync` (Node.js built-in) is used throughout. Synchronous writes are safe from SIGINT and uncaught exceptions without async ceremony — the database is always consistent at the moment of a signal.

Sessions are created by extraction; the wizard passes the session ID to later in-process backend operations.

### pipeline.db — Entity Relationship Diagram

```mermaid
erDiagram
    sessions {
        TEXT id PK
        TEXT name
        TEXT created_at
        TEXT updated_at
    }

    steps {
        INTEGER id PK
        TEXT session_id FK
        TEXT command
        TEXT status
        TEXT started_at
        TEXT completed_at
        TEXT inputs
        TEXT outputs
        TEXT error
        TEXT updated_at
    }

    raw_components {
        TEXT session_id FK
        TEXT component_id
        TEXT name
        TEXT source
        TEXT framework
        TEXT extracted_at
        TEXT status
        TEXT cdf_schema
        TEXT description
    }

    raw_props {
        TEXT session_id FK
        TEXT component_id FK
        TEXT name
        TEXT type
        INTEGER required
        TEXT category
        TEXT default_value
        TEXT description
        TEXT token_reference
        INTEGER position
        TEXT cdf_type
        TEXT cdf_category
        TEXT cdf_token_kind
    }

    raw_prop_allowed_values {
        TEXT session_id FK
        TEXT component_id FK
        TEXT prop_name FK
        INTEGER position
        TEXT value
    }

    raw_prop_token_paths {
        TEXT session_id FK
        TEXT component_id FK
        TEXT prop_name FK
        TEXT source
        INTEGER position
        TEXT path
    }

    raw_token_name_paths {
        TEXT session_id FK
        TEXT raw_name
        TEXT path
        TEXT source
    }

    raw_slots {
        TEXT session_id FK
        TEXT component_id FK
        TEXT name
        INTEGER is_default
        TEXT description
        INTEGER position
    }

    raw_slot_allowed_components {
        TEXT session_id FK
        TEXT component_id FK
        TEXT slot_name FK
        INTEGER position
        TEXT allowed_component
    }

    migrations {
        TEXT name PK
        TEXT applied_at
    }

    sessions ||--o{ steps : "has"
    sessions ||--o{ raw_components : "has"
    raw_components ||--o{ raw_props : "has"
    raw_components ||--o{ raw_slots : "has"
    raw_props ||--o{ raw_prop_allowed_values : "has"
    raw_props ||--o{ raw_prop_token_paths : "has"
    sessions ||--o{ raw_token_name_paths : "has"
    raw_slots ||--o{ raw_slot_allowed_components : "has"
```

`raw_components.status` progresses from `'extracted'` (written by extraction) to `'generated'` (updated by the import wizard's internal generation stage after AI processing). The `cdf_*` columns on `raw_props` and the `description` column on `raw_components` are null until internal generation runs.

`raw_prop_token_paths` is the ordered session sidecar for token-property path lists used for `$token.allowed`. Its `source` is `agent` or `review`; review decisions take precedence over later agent suggestions. The separate `raw_token_name_paths` sidecar stores automatic or manual mappings from an extracted source reference to a canonical DTCG path. These sidecars preserve raw extraction while supporting the CDF projection described above.

### Pipeline Data Flow — Sequence Diagram

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant CLI as CLI import wizard
    participant BP as backend pipeline
    participant DB as pipeline.db
    participant Sel as selection module
    participant Agent as Coding agent<br/>(subprocess)
    participant CMS as Contentful ExO

    Dev->>CLI: experiences import
    opt token file supplied
        CLI->>BP: Start runGenerateTokensSession(...)
        BP->>Agent: Generate token calls
        Agent-->>BP: Token tool calls
        BP->>BP: Parse token tool calls
        BP->>DB: Store DTCG token groups and leaves
    end

    CLI->>BP: runExtractAndComposeSession(...)
    BP->>DB: INSERT session and extracted component data

    CLI->>Sel: Run selection for undecided components
    Sel->>Agent: Invoke agent subprocess
    Agent-->>Sel: select_component / reject_component
    Sel->>BP: Save decisions and rationale
    BP->>DB: Store selection results

    CLI-->>Dev: scope-gate (confirm or change the selection)
    Dev-->>CLI: accepted components
    CLI->>BP: Save accepted and rejected components
    BP->>DB: Store scope-gate decisions

    CLI->>BP: runGenerateComponentsSession(...)
    BP->>DB: Read accepted components and store generated definitions
    BP->>Agent: Invoke agent subprocess
    Agent-->>BP: One JSON tool-call object per line

    opt token file supplied
        CLI->>BP: runMapTokens(...)
        BP->>DB: Resolve defaults and store eligible token restrictions
        BP->>Agent: Infer compatible $token.allowed paths
    end

    CLI-->>Dev: final-review (edit definitions)
    Dev-->>CLI: finalize
    CLI->>CLI: Validate and save combined components.json CDF

    opt credentials provided
        CLI->>CMS: Preview import
        CLI-->>Dev: preview-gate (diff and confirmation)
        CLI->>CMS: Apply import
        CLI->>CMS: Poll operation
        CLI-->>Dev: done (view URL)
    end
```

---

## React Extractor Architecture

The React extractor (`packages/experience-design-system-backend-pipeline/src/steps/extraction/src/framework-adapters/react/extractor.ts`) is the most complex component (~2500 lines). It uses ts-morph to walk the TypeScript AST of each `.tsx`/`.jsx` file.

### Extraction pipeline per file

```
Source file
  ↓
Find exported PascalCase declarations
  ↓
resolvePropsType()
  → unwraps FC<P>, forwardRef<Ref, P>, PropsWithChildren<P>
  → follows type aliases to their declaration
  ↓
extractPropsFromType()
  ├── isPureExpandableDomAttributeWrapperType?
  │     → getSyntheticDomAttributeProps() (curated list)
  ├── shouldMergeDomSyntaxExtraction?
  │     → syntax path only (intersection with DOM wrapper)
  ├── extractPropsFromInterfaceDeclaration()
  │     ├── hasExpandableDomHeritage?
  │     │     → own-declared members only + curated DOM surface
  │     └── else: symbol extraction
  └── extractPropsFromTypeSymbols()
        → TypeScript symbol enumeration
  ↓
classifyProps() — assigns content / design / state categories
  ↓
detectSlots() — children, render props (renderHeader etc.)
  ↓
RawComponentDefinition
```

### DOM attribute prop surfacing

React components commonly extend `HTMLAttributes<T>`, `ButtonHTMLAttributes<T>`, `SVGProps<T>`, etc. Full TypeScript expansion produces hundreds of props. The extractor uses a curated allowlist (`EXPANDABLE_DOM_ATTRIBUTE_TYPE_NAMES`) to restrict which props are surfaced.

### Deduplication

`pipeline.ts` (in the same directory) runs all extractors in parallel, then deduplicates. When the same logical component is found by multiple extractors (e.g., a Vue component also has a `.tsx` wrapper), it picks the preferred source using path heuristics:

1. Index files (`Button/index.tsx`) preferred over named files
2. Shorter paths preferred
3. Canonical `src/components/X/` structure preferred

---

## Source closure evidence

The two default React extraction fronts use the shared component-fact assembly path to adapt bounded compiler observations into `ComponentFacts.sourceClosure` (schema version 1).
The generic `source-closure/index` seam provides deduplicated reachable reads, iterative deterministic strongly connected ordering, memoized acyclic summaries and a finite cyclic fixpoint.
Proof strength (`exact`, `inferred`, `unknown`), used-open dependence, lexical observation identity and provenance are separate fields; no strength represents authoring eligibility.

Summaries reference observations already carried in `sourceObservations`, retaining direct and transitive lexical evidence without copying compiler objects or mutating declared props, candidates, slots or DOM facts.
The syntax reader keeps conditional callee alternatives and distinct reference and markup destinations; unsupported bodies, unresolved targets, resource omissions and external or input-supplied dependencies remain explicit.
This contract does not establish runtime execution, complete output flow, caller-value contracts or finite slot domains.

The strict public guard is reused by the backend sidecar reader, which also checks observation membership against the same source snapshot.
Completed extraction binds declaration hashes and the capture/session/step/envelope identity in the existing transaction.
Reopen validates that identity and recomputes hash binding from saved capture receipts before actual selection, generation and review consumers receive the evidence.
Uncaptured, changed or unverified source and failed closure remain explicit; a converged fixpoint cannot improve source binding or completed-source readiness.
After successful completion, saved bytes remain the source snapshot even if the files on disk subsequently change.

Generic fact equality supports immutable acyclic finite primitives, arrays, maps, sets and plain records; persistence accepts only plain JSON evidence.
In-place value mutation, arbitrary class instances and cyclic values are unsupported.
Cycle iterations are finite and configurable with `sourceClosureMaxIterations`; existing observation/compiler/capture budgets and cooperative cancellation remain separate from total graph size, compiler latency and nested equality work.
The new summaries travel in the existing compiler evidence channel, while shared-source prompt projection preserves all captured files, ranges and observations with their original coverage receipts.

## Internal Generation

The CLI resolves the component, token, and selection skill files from its packaged `skills/` assets and passes those paths to backend-pipeline operations. The CLI build copies the primary markdown sources from `packages/experience-design-system-backend-pipeline/src/agents/skills/`; matching fallback copies live under `packages/experience-design-system-backend-pipeline/src/agents/skills/`. Backend lookup checks the requested file in both the primary CLI layout (flat generation/selection filenames plus `explore/` and `consensus/`) and the grouped backend fallback layout, rather than accepting a directory without verifying its requested asset. Exploration loads the exploration, tier, verification and checking skill content during preparation, before any model invocation, and reuses that content throughout the phase; missing assets therefore fail before exploration instead of after completed model work.

The backend pipeline owns prompt assembly and agent invocation. It combines each skill file with a runtime preamble, embeds session data in the logical prompt, invokes the selected local coding agent, parses one JSON tool-call object per output line, and applies valid calls to the session database. Component data continues to flow between stages through the session database; temporary prompt artifacts are only subprocess transport.

Each component-generation prompt also receives the completed detail exploration's judgments for that exact component and source: reported consensus, independently checked resolutions and their evidence, remaining competing claims, associated hypotheses, and modeling notes. The handoff validates the current detail/parent run identities and uses the repository's source-envelope and human-scope checks. These judgments are an advisory starting point for representation selection and validation; source facts and accepted slot ownership retain their authority. Generation explains departures from earlier judgments and keeps unsupported representation requirements explicit. Exploration does not directly write CDF property decisions, and generation's existing materialization and admission checks still run.

Session and standalone generation validate each property through the same source-bound materializer and projection rules. Pending properties receive structured issues, candidate alternatives, representation plans and capability requirements. An invocation-scoped read-only Node command lets the agent check draft tool-call lines on stdin against a private immutable evidence file; it never loads live source or executes source expressions. When that command is unavailable, host-fed correction remains available and host validation still runs. A maximum of two attempts shares one operation deadline; successful decisions stay fixed, and repairs preserve pending properties' semantic category and source identity. Remaining unresolved decisions omit representation companions and retain concrete reasons. Inventory completeness and representation admission are separate results; the existing downstream held-result failure behavior remains until review routing is implemented. Evidence cleanup waits for invoked subprocesses to settle, including cancellation.

The CLI resolves the component, token, and selection skill files from its packaged `skills/` assets and passes those paths to backend-pipeline operations. The CLI build copies the primary markdown sources from `packages/experience-design-system-backend-pipeline/src/agents/skills/`; matching fallback copies live under `packages/experience-design-system-backend-pipeline/src/agents/skills/`.

The backend pipeline owns prompt assembly and agent invocation. It combines each skill file with a runtime preamble, embeds session data inline, invokes the selected local coding agent, parses one JSON tool-call object per output line, and applies valid calls to the session database. Raw components are not passed to the agent as file paths.

The generation and backend prompt APIs also accept the additive `debate-select` skill. It supplies one role, one disagreement, source evidence, and an optional existing-model path to a prompt that returns one argument object. This prompt does not dispatch a FOR/AGAINST pair or make the final component-selection decision. The backend owns the primary skill asset, the CLI asset-copy target includes it, and the backend build packages a narrow fallback under its selection skills.

Do not use agent SDKs or APIs — the import wizard invokes agents as local subprocesses only.

Exploration captures the renderer reference in full with its origin, digest and retrieval time. Renderer documentation has no default read-size limit and is not truncated. Composition candidates, prompt overrides, optional context inputs, shared-source evidence and complete stage prompts have no application size limit or byte-based truncation. All captured evidence is retained, including compiler contexts, reference indexes, inventories and observations. The filesystem compatibility reader also includes the full component text and every discovered sibling rather than fixed-length excerpts or an inlining count cap. Historical capture `maxPromptBytes` and projection-bound metadata are ignored; new captures do not set a prompt budget. Source discovery and capture limits still describe what evidence was collected, and missing evidence remains unknown. Empty references, retrieval failures, malformed context and cancellation retain their existing handling. Claude and Codex default to stdin; explicit transport choices and other agents retain their existing delivery mode without application byte rejection. Operating-system argument limits and provider context windows still apply. Failed stage invocations preserve the exit code and the agent diagnostic in their attempt receipts and operator error message. The wizard connects exploration subprocess events to the session debug log and drains pending log writes before the selection step settles.

Codex also enforces an initial-turn input limit of 1,048,576 characters independently of the model context window. Both local runners switch oversized Codex prompts to a private, read-only temporary artifact containing the complete original task and evidence. The initial request supplies the artifact path and instructions to read the task and query evidence in manageable pieces. This permits access only to the supplied artifact; it does not grant access to live repository evidence. No prompt content is discarded, and model context limits still apply. Artifacts remain available until the child settles, then are removed on success, failure, cancellation or timeout. Debug events distinguish original and delivered prompt lengths and record the delivery mode. This transport is unrelated to pipeline caching.

---

## Apply Flow

Preview and push are steps inside the import wizard; there is no separate `apply` command. After final review, the CLI builds and validates the combined `components.json` CDF in `packages/experience-design-system-cli/src/tui/import/steps/10-flow/flow/save.ts`.

The CLI flow owns preview and confirmation screens. Backend-pipeline apply operations use the generated client to request a preview, apply the reviewed document, and poll the operation.

---

## The Import Command — Wizard

`experiences import` requires an interactive terminal and has no headless mode. It takes `--agent`, repeatable `--prompt <stage=value>` and `--no-cache`; the project and token files are collected on wizard screens.

The Ink wizard lives under `packages/experience-design-system-cli/src/tui/import/steps/` and runs the import flow in the CLI process:

```
extracting (selection agent runs here)
        → scope-gate → generating → final-review → path-prompt
        → previewing → preview-gate → pushing → done
```

The CLI collects credentials, calls backend-pipeline operations for extraction and generation, and owns the scope gate, final review, save, preview, and push screens. Skipping credentials saves files only; preview and push are skipped.

A single human scope gate precedes generation. Final review edits generated definitions inline; after review the wizard saves one combined `components.json` CDF, then previews and pushes it when credentials are available.

`--no-cache` bypasses the extract, selection and generation caches and is forwarded to the internal stages.

### Automatic component exploration caching

The normal wizard flow runs fresh source extraction/composition, then automatically checks a persistent cache for each of the seven component-exploration scopes. It does not require a resume flag, restore an old source snapshot or change wizard routing. A successful scope is saved independently, so a later explorer or downstream failure does not discard completed agent work. Unfinished or invalid calls run again.

The key hashes the complete logical explorer input and current rules/skill, declared agent/model and Bedrock mode. It retains source text/hashes, declared component/slot identities, coverage/omissions, complete compiler diagnostics, renderer content and existing-entity context. Fresh session/capture/envelope identities and source-closure capture-binding identities are normalized only in key material; actual prompts and current-source validation retain them. Discovery timing and renderer retrieval timestamps also do not change task identity. The cache therefore survives a new import session while source, model, prompt or evidence changes cause fresh calls. Unknown/default-auto models cannot reuse saved calls.

Import-owned `.contentful` output is excluded from source discovery. The importer must not collect its own growing debug logs, entity snapshots and generated import files as evidence for the next import; other generated code remains eligible for discovery. Cache responses are checksum-checked and reparsed, their source-input associations are validated against current components, and accepted-phase derivation/publication still executes in the current run. `component_exploration_cache_hits` records the producing run separately from actual invocation attempts.

`--no-cache` bypasses component-explorer cache reads while still saving successful responses. Unfingerprinted historical reports need one fresh pass. Detail inventories, reconciliation, verification, token work and CDF generation keep their existing execution behavior. Extraction caching remains disabled in the wizard.

### Run records

After every successful wizard session, the CLI appends a record to `~/.contentful/experience-design-system-cli/state/runs.json`.

### Agent and model

`--agent <name>` accepts `claude`, `codex`, `opencode`, `cursor` or `copilot`, optionally with a model (`--agent claude:sonnet`). Resolution order is flag → `credentials.json` → built-in default; `EDS_AGENT_MODEL_<AGENT>` sets a per-agent model.

### Selection rationale

The selection agent's accept and reject rationale is stored in `raw_components.reject_reason` in `pipeline.db` and shown in the scope-gate and final-review panels.

---

## TUI Architecture

The import wizard renders Ink (React) components in a TTY and has no non-interactive mode. Preview and push are steps in this wizard.

| Flow     | TUI components                                                                      |
| -------- | ----------------------------------------------------------------------------------- |
| `import` | Step components under `packages/experience-design-system-cli/src/tui/import/steps/` |

The TUI uses React hooks for state (`useState`, `useReducer`), Ink's `useInput` for keyboard, and a custom `useUndo` hook for the JSON editor.

During extraction, component exploration reports saved-evidence loading, prompt preparation, the active explorer scope, completed reports and finalization. The progress bar counts persisted scope reports, not estimated progress within a model response; failed attempts do not add completed scopes. The elapsed timer uses wall time so delayed event-loop callbacks do not lose elapsed seconds. Completion is reported after the accepted phase is published to the session database.

The scope-gate step shows two columns at 100 or more terminal columns and one column below that. `NO_COLOR=1` suppresses ANSI color.

---

### Exploration response validation

Exploration prompts explicitly describe notes and slot-object fields for both component selection and selected-component inventory. The parser preserves a single string modeling note as a one-item string array before applying the canonical report schema; slot rulings, property fields and identities retain strict validation. Schema errors identify the affected field paths. A failed response parse supplies its validation error as data on the next existing stage attempt, without copying the rejected response or changing retry/deadline budgets. Missing slot booleans are never synthesized, and validated complete responses remain required before reports are saved.

### Diagnostic prompt projection

Exploration, reconciliation and verification prompts summarize compiler filesystem reads and group source exclusions by reason. Compiler coverage, project/configuration receipts, module and reference outcomes, resource counters, notable failed or changed reads, and unknown diagnostic records remain inline. Full diagnostics remain saved in the session database. Each summarized invocation also receives a private, read-only JSON audit containing its exact original diagnostic array, identified by its SHA-256 digest and byte length; read-only tools may inspect that supplied audit without accessing the live repository. The audit is removed only after the invocation settles, including failure, retries, cancellation and timeout. Prompt construction failures also clean the audit. Summary projection does not change capture identity, extraction binding, coverage or omission counts, and does not truncate evidence or introduce a prompt size limit.

## V2 TUI Resources

Design patterns and detailed guidelines for building v2 TUI screens are documented in:

- **`packages/experience-design-system-cli/DSI_TUI_ARCHITECTURE.md`** — v2 architecture and screen guidelines
- **`packages/experience-design-system-cli/.claude/skills/ink-api/SKILL.md`** — Ink core API (Box, Text, colors, hooks)
- **`packages/experience-design-system-cli/.claude/skills/ink-ui/SKILL.md`** — Ink UI component reference

### Primitive choices and import prerequisites

Finite source choices retain their primitive string, number or boolean type with typed `$values`; `enum` is rejected rather than silently converted. Complete compiler domains are checked for both narrowing and widening, and numeric design intent is retained without automatic conversion to a token. The editor preserves typed choices and their order. The deployed mapper gate independently holds finite constraints and unsupported manual numeric design definitions.

The final CDF produces a deterministic prerequisite graph for planned token definitions and generated model dependencies. A filtered document cannot drop a required planned dependency. Target catalogue captures are bound to the session source evidence, property profile and normalized target; token paths and platform identifiers remain separate namespaces with explicit mappings. Catalogue observations and mapping revisions are immutable, and receipts retain their exact observation after subsequent captures. Unknown catalogue or capability evidence never proves readiness. Local document receipts bind the exact CDF, prerequisite graph, source and target observation; they do not resume an agent or establish remote publication. Preview and apply revalidate those inputs before sending a request.

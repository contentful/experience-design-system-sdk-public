# Architecture

## Overview

The Experience Design System SDK is an Nx monorepo that ships two packages:

| Package | Purpose |
|---|---|
| `@contentful/experience-design-system-cli` | CLI + TUI for extracting, reviewing, generating, validating, and pushing design system component definitions |
| `@contentful/experience-design-system-types` | Shared TypeScript types, Zod schemas, and validation logic for CDF and DTCG formats |

The CLI is the developer-facing ingestion tool in the design system import pipeline. A developer runs it against their component library to produce curated, validated artifacts, then pushes them directly into Contentful Experience Orchestration (ExO) from their terminal.

---

## System Context

```
Design system codebase
  (React / Vue / Astro / Stencil / Web Components)
        │
        ▼
  experience-design-system-cli  (binaries: experiences | exo | experience-design-system-cli)
    ├── import (wizard)         → interactive TUI; drives the full pipeline + scope-gate + final-review + save/push
    ├── import (headless)       → orchestrator that shells out to the subcommands below
    ├── runs                    → list/detail/replay prior wizard runs from ~/.config/experiences/runs.json
    │                              (positional <id-or-path>, --json, --pushed, --not-pushed)
    ├── analyze extract         → session DB (raw components)
    ├── analyze select          → session DB (accepted/rejected decisions, standalone JsonEditor TUI)
    ├── analyze select-agent    → session DB (agentic accept/reject + per-component rationale)
    ├── generate components     → session DB (CDF artifact via coding agent)
    ├── generate tokens         → session DB (DTCG artifact via coding agent)
    ├── print components|tokens → write components.json / tokens.json from session DB
    ├── print validate          → validates CDF / DTCG files, exits 0/1
    ├── apply preview           → diff output (no writes)
    ├── apply select            → interactive entity picker → PUT /component_types/:id, PUT /design_tokens/:id
    ├── apply push              → PUT /component_types/:id, PUT /design_tokens/:id; emits viewUrl
    ├── session list|show|...   → lower-level pipeline-session management
    ├── setup                   → interactive prereq + credentials wizard
    └── doctor                  → prereq health check
                              │
                              ▼
                      Contentful ExO
                (component types + design tokens)
```

All intermediary data between pipeline steps flows through a local SQLite session database (`~/.contentful/experience-design-system-cli/pipeline.db`). `print components` / `print tokens` write `components.json` / `tokens.json` on demand. The `apply` subcommands read those files (or read directly from the session DB via `--session`).

A separate JSON file at `~/.config/experiences/runs.json` records each successful wizard session (id, project path, save path, push target, component count) so it can be replayed with `experiences import --push-from-run` or `experiences import --modify`.

---

## Packages

### `experience-design-system-cli`

**Key dependencies:**
- `typescript` — runtime dependency; the CLI compiles customer source files at analysis time. See `docs/adr/2026-04-22-typescript-as-runtime-dependency.md`.
- `ts-morph` — TypeScript compiler API wrapper; all static analysis goes through this
- `ink` — React for the terminal; all TUI components are standard React functional components
- `commander` — CLI argument parsing and help text
- `node:sqlite` (`DatabaseSync`) — built-in Node.js synchronous SQLite for pipeline session state

### `experience-design-system-types`

CDF and DTCG type definitions, JSON schemas, and validation utilities. Published as a separate package and consumed by both the CLI and by customer codebases.

---

## Data Formats

### RawComponentDefinition (extraction output)

Produced by `analyze extract`, stored in the pipeline session database, consumed by `analyze edit` and `generate components`:

```typescript
interface RawComponentDefinition {
  name: string;                           // PascalCase component name
  source: string;                         // absolute path to source file
  framework: 'react' | 'next' | 'vue' | 'astro' | 'web-component' | 'stencil';
  props: RawPropDefinition[];
  slots: RawSlotDefinition[];
}

interface RawPropDefinition {
  name: string;
  type: string;                           // TypeScript type string
  required: boolean;
  category?: 'content' | 'design' | 'state';
  defaultValue?: string;
  allowedValues?: string[];               // for enum / union types
  description?: string;
  tokenReference?: string;                // e.g. "color.brand.primary"
}

interface RawSlotDefinition {
  name: string;
  isDefault: boolean;                     // true = children slot
  description?: string;
  allowedComponents?: string[];
}
```

### CDF (Component Definition Format)

The finalized format for Contentful ExO import. Produced by `generate components`, consumed by `apply preview/select/push`:

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
  $type: CDFPropertyType;   // 'string' | 'boolean' | 'number' | 'enum' | 'reference' | 'object' | 'rich-text'
  $category: CDFPropertyCategory;  // 'content' | 'design' | 'state'
  $description?: string;
  $required?: boolean;
  $default?: unknown;
  $values?: string[];
  '$token.kind'?: string;
}
```

### DTCG (W3C Design Token Format)

Design token files following the W3C DTCG spec. Produced by `generate tokens`, consumed by `apply preview/select/push`:

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

All commands share a single SQLite database at `~/.contentful/experience-design-system-cli/pipeline.db` (overridable via `EDS_PIPELINE_DB_PATH`). A second database, `import.db`, tracks per-entity push results for `apply push` resumption.

`DatabaseSync` (Node.js built-in) is used throughout. Synchronous writes are safe from SIGINT and uncaught exceptions without async ceremony — the database is always consistent at the moment of a signal.

Sessions are created by `analyze extract` and auto-resolved by downstream commands: if `--session` is omitted, each command picks up the most recent completed `analyze extract` session.

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
    raw_slots ||--o{ raw_slot_allowed_components : "has"
```

`raw_components.status` progresses from `'extracted'` (written by `analyze extract`) to `'generated'` (updated by `generate components` after AI processing). The `cdf_*` columns on `raw_props` and the `description` column on `raw_components` are null until `generate components` runs.

### import.db — Entity Relationship Diagram

```mermaid
erDiagram
    sessions {
        TEXT id PK
        TEXT space_id
        TEXT environment_id
        TEXT started_at
        TEXT updated_at
    }

    items {
        TEXT session_id FK
        TEXT entity_type
        TEXT entity_id
        TEXT status
        TEXT action
        TEXT error
        TEXT updated_at
    }

    sessions ||--o{ items : "has"
```

`import.db` is keyed by `(space_id, environment_id)` — one session per Contentful environment. Each `apply push` upserts item rows as entities are written, enabling resumption after a partial failure.

### Pipeline Data Flow — Sequence Diagram

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant AE as analyze extract
    participant DB as pipeline.db
    participant AnEdit as analyze edit
    participant GC as generate components
    participant Agent as Coding agent<br/>(subprocess)
    participant Val as validate
    participant AP as apply push
    participant CMS as Contentful ExO

    Dev->>AE: eds analyze extract --project ./src
    AE->>DB: INSERT sessions (id, ...)
    AE->>DB: INSERT steps (command='analyze extract', status='pending')
    AE->>AE: Walk source files, run extractors
    AE->>DB: INSERT raw_components, raw_props, raw_slots
    AE->>DB: UPDATE steps SET status='complete'
    AE-->>Dev: stdout: session=<id>

    Dev->>AnEdit: eds analyze edit [--session <id>]
    AnEdit->>DB: SELECT raw_components WHERE session_id=?
    AnEdit-->>Dev: Launch TUI (accept / reject / edit props)
    Dev-->>AnEdit: Finalize decisions
    AnEdit->>DB: UPDATE raw_components SET status='accepted'/'rejected'

    Dev->>GC: eds generate components --agent claude [--session <id>]
    GC->>DB: SELECT raw_components WHERE status='accepted'
    GC->>GC: Build prompt (inline JSON)
    GC->>Agent: spawn subprocess (stdin closed)
    Agent-->>GC: stdout: <<<EDS_OUTPUT_START>>> ... <<<EDS_OUTPUT_END>>>
    GC->>GC: validateCDF(output)
    GC->>DB: UPDATE raw_components SET status='generated', description=?
    GC->>DB: UPDATE raw_props SET cdf_type=?, cdf_category=?
    GC->>GC: Write components.json to disk
    GC-->>Dev: stdout: Wrote components.json

    Dev->>Val: eds validate --components components.json
    Val-->>Dev: Exit 0 (valid) or exit 1 + errors

    Dev->>AP: eds apply push --components components.json --space-id ... --yes
    AP->>CMS: GET /component_types, GET /design_tokens (prefetch)
    AP->>AP: Diff local vs remote → new / changed / unchanged / conflict
    AP-->>Dev: Confirmation prompt (skipped with --yes)
    loop For each entity
        AP->>CMS: PUT /component_types/:id or PUT /design_tokens/:id
        AP->>DB: UPSERT items (import.db) status='succeeded'/'failed'
    end
    AP-->>Dev: Summary (N created, M updated, K failed)
```

### Autonomous import — Sequence Diagram

The `import` command orchestrates the full pipeline in a single invocation, shelling out to the individual CLI commands:

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant Orch as import orchestrator
    participant AE as analyze extract<br/>(subprocess)
    participant AnEdit as analyze edit<br/>(subprocess)
    participant GC as generate components<br/>(subprocess)
    participant AP as apply push<br/>(subprocess)

    Dev->>Orch: eds import --project ./src --agent claude --space-id ...

    Orch->>AE: execFile eds analyze extract --project ./src
    AE-->>Orch: stdout: session=<id>
    Orch->>Orch: Parse session=<id> from stdout

    alt edit flags present (--accept-all / --reject / --patch)
        Orch->>AnEdit: execFile eds analyze edit --session <id> [flags]
        AnEdit-->>Orch: exit 0
    end

    Orch->>GC: execFile eds generate components --agent claude --session <id> --out .contentful/
    GC-->>Orch: exit 0

    Orch->>AP: execFile eds apply push --components .contentful/components.json --yes ...
    AP-->>Orch: exit 0

    Orch-->>Dev: Pipeline complete
```

---

## React Extractor Architecture

The React extractor (`analyze/extract/react.ts`) is the most complex component (~2500 lines). It uses ts-morph to walk the TypeScript AST of each `.tsx`/`.jsx` file.

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

React components commonly extend `HTMLAttributes<T>`, `ButtonHTMLAttributes<T>`, `SVGProps<T>`, etc. Full TypeScript expansion produces hundreds of props. The extractor uses a curated allowlist (`EXPANDABLE_DOM_ATTRIBUTE_TYPE_NAMES`) to restrict which props are surfaced. See `docs/adr/2026-04-22-dom-attribute-prop-surfacing-strategy.md`.

### Deduplication

`pipeline.ts` runs all extractors in parallel, then deduplicates. When the same logical component is found by multiple extractors (e.g., a Vue component also has a `.tsx` wrapper), it picks the preferred source using path heuristics:
1. Index files (`Button/index.tsx`) preferred over named files
2. Shorter paths preferred
3. Canonical `src/components/X/` structure preferred

---

## The Generate Command

`generate components` and `generate tokens` build a prompt by combining a skill file (markdown instructions) with a runtime preamble:

- **Skill file** — `skills/generate-components-source.md` or `skills/generate-tokens-source.md`; shipped with the package and located at runtime by walking up from the compiled output
- **Runtime preamble** — sets mode (autonomous/interactive), embeds raw component data inline as JSON, lists optional file paths, and instructs the agent on the output protocol

**Output protocol (autonomous mode):** the agent prints its result between `<<<EDS_OUTPUT_START>>>` and `<<<EDS_OUTPUT_END>>>` sentinel markers. `extractSentinelOutput()` handles extraction and detects multiple-block errors.

**Raw components are passed inline, not as a file path.** The session database is read before the prompt is built, and the JSON array is embedded directly in the prompt text. This removes any file system coupling between `analyze extract` and `generate components`.

Do not use agent SDKs or APIs — the generate command invokes agents as subprocesses only. See `docs/adr/`.

---

## The Apply Command

`apply` has three subcommands that share all connection flags and the same diff computation logic:

- `apply preview` — read-only diff; exits 0 if clean, 1 if there are kind conflicts
- `apply select` — interactive checkbox TUI for picking a subset of entities; non-interactive via `--select-all`, `--select`, `--deselect`
- `apply push` — writes all (or selected) entities to Contentful; `--yes` skips confirmation

**Phases:**

1. **Pre-flight** — validate flags, resolve CMA token, check environment exists, parse + validate CDF/DTCG files
2. **Diff computation** — pre-fetch all remote entities → deep-compare mapped local vs remote body → classify as new/changed/unchanged/kindConflict
3. **Confirmation** (`push` only) — interactive summary with "Press Enter to confirm", skipped with `--yes`
4. **Write** (`push` only) — sequential PUT loop: tokens first, then component types; exponential backoff on 429; abort on 401/403; each write is recorded in the session DB
5. **Result** — summary TUI or JSON to stdout

**`cdf-mapper.ts` property routing:**
- `$category === 'content'` or `'state'` → `contentProperties[]`
- `$category === 'design'` → `designProperties[]` (outer keys are viewport IDs, not property names)

**Default viewport:**
```json
{ "id": "all", "query": "*", "displayName": "All Sizes", "previewSize": "100%" }
```

---

## The Import Command — Wizard and Orchestrator

`experiences import` has two modes:

### Interactive wizard (TTY default)

`src/import/tui/WizardApp.tsx` renders a full-screen Ink TUI driven by an explicit step machine:

```
welcome → extracting → [auto-filter (select-agent)] → scope-gate
        → credentials (generate runs in parallel) → final-review
        → preview → push-decision-gate → pushing → done
```

A single human review gate (`scope-gate`) replaces the older two-step extract + generate-edit gates. The final-review step is a minimum-viable port of the standalone `JsonEditor` with lifted rationale + source panels, inline `$default` and `$allowedComponents` editing, and live preview re-runs after each save (`--no-live-preview` to disable). Generate runs in parallel with the credentials step (`spawn-generate.ts`) so the operator does not wait on the agent. The push-decision-gate defaults to save AND push; `--no-save` and `--no-push` carve out the alternatives. `--out-dir <path>` short-circuits the save-path prompt.

The wizard's AI auto-filter (auto-invocation of `analyze select-agent` before scope-gate) is configurable per run via `--auto-filter` / `--no-auto-filter` and persisted to `~/.config/experiences/credentials.json`.

### Headless orchestrator

`src/import/orchestrator.ts` is the non-interactive sibling. It shells out to the individual CLI subcommands in sequence via `child_process.execFile`:

1. `analyze extract --project <path>` → captures `session=<id>` from stdout
2. Optionally `analyze select --session <id>` (with `--select-all`, `--select`, `--deselect`, or `--reject`) — or `analyze select-agent` by default
3. `generate components --agent <name> --session <id>`
4. `apply push --components <components.json> --space-id ... --environment-id ... --yes`

Headless mode is entered when any of `--auto-accept-scope`, `--skip-analyze`, `--skip-generate`, `--skip-apply`, `--yes`, `--dry-run`, or a credential flag is set. In non-TTY without one of those flags, the command exits 1 with a fail-loud message.

`--skip-analyze` and `--skip-generate` reuse the most recent session for the respective step. `--no-cache` bypasses extract/select/generate fine-grained caches and is forwarded to `analyze select-agent` and `generate components`.

### Replay

After every successful wizard session, the CLI appends a record to `~/.config/experiences/runs.json`. The replay helpers in `src/runs/replay-helpers.ts` power two `import` flags:

- `--push-from-run <id-or-path>` — re-push the recorded session without re-opening the wizard. Never writes to disk. Mutually exclusive with `--modify`, `--project`, `--no-save`, `--no-push`.
- `--modify <id-or-path>` — fully wired re-open: loads the recorded session from `pipeline.db` (skipping extract and generate), pre-fills credentials from the run record's `pushedTo` target, and lands directly on `final-review` (or `scope-gate` if the run record sets `entryStep`). Pair with `--overwrite` (save back to recorded `savePath`) or `--save-as-new` (prompt for new path).

`experiences runs` (alias `ls`) lists the contents of `runs.json` for use with either flag. A positional `<id-or-path>` argument switches it into single-run detail mode; `--json`, `--pushed`, and `--not-pushed` filter the output. Table columns auto-expand to fit long project / save paths; a copy-friendly footer prints command hints for the newest run.

### Run-picker

When `runs.json` is non-empty, stdin is a TTY, and none of `--push-from-run`, `--modify`, or `--project` was passed, the wizard mounts an interactive **run-picker** (`src/runs/tui/RunPicker.tsx`) before the `welcome` step. The picker lets the operator push or modify a recent run, expand to "show all", or start a new run; selecting an existing run routes through the `--push-from-run` or `--modify` code path. Mount-decision logic lives in `src/runs/run-picker-mount.ts`.

### Headless save-conflict resolution

`--on-conflict <overwrite|skip|fail>` bypasses the wizard's interactive `<SaveConflictGate>` when a file already exists at the save path — required for non-TTY runs that still write `components.json` to disk. Mutex with `--no-save`.

### Prompt-print and model / agent overrides

- `--print-prompt` prints the generate prompt to stdout and exits. It supersedes the prompt-print semantics of `--dry-run`, which is now deprecated and emits a stderr deprecation notice.
- `--model <name>` overrides the stored model; resolution order is flag → `credentials.json` → built-in default.
- `--agent <name>` is a functional wizard override (earlier releases plumbed it but the commander default shadowed it).

### Read-only rationale view

`experiences analyze select-agent --show-rationale [--json] [--session <id>]` reads `raw_components.reject_reason` from `pipeline.db` and prints the recorded accept / reject rationale for every component in the session. No LLM call, no schema change — it is purely a session-DB reader, safe to run against any completed session.

---

## TUI Architecture

All commands have two output modes:

| Mode | Trigger | Implementation |
|---|---|---|
| Non-interactive | `!process.stdout.isTTY` | Plain text to stdout/stderr |
| Interactive TUI | TTY detected | Ink (React) component tree |

| Command | TUI components |
|---|---|
| `analyze extract` | `AnalyzeView` |
| `analyze select` (alias `analyze edit`) | Standalone JsonEditor: `App`, `Sidebar`, `ComponentDetail`, `JsonEditor`, `SourcePanel`, dialogs (untouched by wizard rebuild; pinned by snapshot test) |
| `generate components/tokens` | `GenerateView` |
| `print validate` | `ValidateView` |
| `apply preview` | `SummaryView` + `EntityDiffView` |
| `apply select` | `SelectView` (checkbox picker) + `ApplyView` (progress + result) |
| `apply push` | `ApplyView` (confirmation + progress + result), `SummaryView`, `EntityDiffView` |
| `import` (wizard) | `WizardApp` + step components in `src/import/tui/steps/` (`WelcomeStep`, `CredentialsStep`, `ScopeGateStep`, `GenerateReviewStep`, `WizardPreviewStep`, `PushDecisionGateStep`, `PushingStep`, `DoneStep`, `ErrorStep`, `PreviewValidationErrorStep`), plus hosts (`scope-gate-host`, `final-review-host`) |

The TUI uses React hooks for state (`useState`, `useReducer`), Ink's `useInput` for keyboard, and a custom `useUndo` hook for the JSON editor.

Terminal width thresholds:
- 60 columns — minimum for the wizard and `analyze select` TUI
- 80 columns — sidebar + detail view
- 120 columns — source panel in `analyze select`

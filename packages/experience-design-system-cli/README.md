# @contentful/experience-design-system-cli

CLI for extracting, reviewing, generating, validating, and pushing Contentful Experience Design System component definitions into Experiences.

## Binaries

The package installs three equivalent binaries:

| Binary                          | Notes                                                                |
| ------------------------------- | -------------------------------------------------------------------- |
| `experiences`                   | Preferred entry point — short and operator-facing                    |
| `exo`                           | Shorthand for Experience Orchestration                               |
| `experience-design-system-cli`  | Full name; used in CI / scripts where clarity matters                |

The rest of this README uses `experiences`.

## CLI Overview

There are two ways to use the CLI:

1. **`experiences import`** — the wizard. Drives the full pipeline (extract → AI select → scope-gate → internal generation → final-review → save/push) from a single command. It runs as a full-screen interactive TUI in a real terminal or non-interactively when you pass credentials. **This is the recommended path for almost everyone.**

2. **Standalone subcommands** — for piping into other tools, CI parity with the wizard, or for debugging individual steps:

   ```
   analyze extract   →   analyze select-agent   →   apply push
   ```

   `analyze select-agent` is the agent-driven selection step the wizard uses. You can replace it with `analyze select` for the older manual JsonEditor TUI.

**Determinism boundary.** `analyze extract` is fully deterministic: ts-morph AST parsing produces the same component list and prop shape on every run, then a deterministic pre-classifier and a structural non-authorable filter shape the output. AI enters the pipeline at `analyze select-agent` and the import wizard's generation step. This split keeps the extracted artifact reproducible — if an extracted component looks wrong, the cause is in the rules, not in agent variability.

All intermediate data flows through a local SQLite session database (`~/.contentful/experience-design-system-cli/pipeline.db`). No JSON files are written between steps — each command reads its inputs from the session and writes its outputs back to it. Use `print` to export session data to JSON files on demand. The wizard additionally maintains a separate **runs.json** file (`~/.config/experiences/runs.json`) that records each successful wizard session.

---

## Composite components & composition

A **composite component** is one that renders other components inside it — a `Card` that slots a `Button` and an `Icon`, a `Tabs` that slots `Tab` panels. When you import composite components, the CLI can populate each slot's `$allowedComponents` so the parent→child relationships survive into Contentful.

### Atomic vs. composite

Imports are **atomic by default** — flat components, no embedded hierarchy. This is the right choice when you just want each component registered on its own. Opt into hierarchy resolution with `--composite` (or any composition flag, which implies it).

| Mode | Flag | Behavior |
|---|---|---|
| Atomic | `--atomic` (default) | Flat import; composition stripped before push |
| Composite | `--composite` | Resolve and import the parent→child hierarchy |

### How composition is resolved

Under `--composite`, relationships are resolved from the highest-confidence source available, in this precedence order:

1. **Typed slots (code)** — slots the source already declares, e.g. React `ReactElement<XProps>` / `children`, Svelte `Snippet<[XProps]>`, or an explicit `@allowedComponents` JSDoc tag. Fully deterministic; picked up automatically.
2. **Mapping map** — a hand-authored parent→children interchange map you feed with `--composition-map <path>`. Use `--generate-map <path>` to emit a skeleton from whatever was resolved, then hand-edit it and feed it back.
3. **Agent (`--composition-agent`)** — for codebases that encode composition in *code patterns* rather than typed slots (common in real-world design systems). Only runs when the deterministic sources above find nothing.

When more than one source speaks to the same relationship, the higher-precedence one wins (**code slots > map > agent**).

### The composition agent

`--composition-agent` asks a coding agent to list parent→child relationships as edges. The output is cached by the candidate-file set + agent identity, so repeated runs over the same code reuse the resolved edges without re-invoking the agent.

- `--composition-refresh` — ignore the cache and re-resolve from scratch, forcing the agent to run.
- `--agent <name>` — which coding agent resolves composition (`claude`, `codex`, `opencode`, `cursor`, `copilot`).
- `--prompt composition=<file-or-text>` — override the composition stage's prompt.

Because the agent path spawns a coding agent, it adds latency and cost and is best-effort. For reproducible results, prefer `--composition-map`.

### Slot cycles

If the resolved graph contains a circular slot dependency (A slots B, B slots A), it is detected before push. `apply push` and the wizard's push path **refuse to send a manifest with cycles**; the cycle path is reported so you can break it.

---

## Prerequisites

### Coding agent

The import wizard's generation steps require a coding agent CLI in your `$PATH`. Choose one:

| Agent | Install | Auth |
|---|---|---|
| **Claude Code** (`claude`) | `npm install -g @anthropic-ai/claude-code` | `claude login` (browser OAuth) **or** set `ANTHROPIC_API_KEY` |
| **OpenAI Codex** (`codex`) | `npm install -g @openai/codex` | Set `OPENAI_API_KEY` |
| **OpenCode** (`opencode`) | `npm install -g opencode-ai` | Configure via `opencode auth` (supports multiple providers) |
| **Cursor** (`cursor`) | Install [Cursor](https://cursor.com) | Sign in to Cursor; exposes `cursor-agent` binary |
| **GitHub Copilot** (`copilot`) | `npm install -g @github/copilot` | Run `copilot` once to complete GitHub OAuth login. Free plan uses Auto model selection by default. Paid plans can pin a specific model via `EDS_AGENT_MODEL_COPILOT=<model-id>` (e.g. `claude-sonnet-4.6`) |

The CLI invokes the agent non-interactively in a subprocess. If the binary is not found in `$PATH`, the command exits 1 and prints manual fallback instructions.

`experiences setup` persists your chosen agent (and optional model + custom prompt paths) to `~/.config/experiences/credentials.json`; later commands pick them up automatically.

### Contentful credentials

`apply push` and `import` (when pushing) require access to a Contentful space. Set these environment variables or pass the equivalent flags:

```bash
export CONTENTFUL_MANAGEMENT_TOKEN=<your-cma-token>   # required
export CONTENTFUL_SPACE_ID=<your-space-id>             # required
export CONTENTFUL_ENVIRONMENT_ID=master                # required
```

Or run `experiences setup` once and they get saved to `credentials.json` and pre-filled in the wizard.

In the wizard's credentials step you can press `[s] Skip` to save-only without pushing — useful when you want a checked-in `components.json` without a live push.

---

## The `import` wizard

```bash
experiences import [flags]
```

`experiences import` is the primary entry point. In a TTY it launches a full-screen wizard. With credentials it runs non-interactively. Without a supported headless entry point, it fails loud rather than hanging.

### Wizard step machine

```
welcome
  ↓
extracting             — runs analyze extract (atomic by default; resolves composition
                         under --composite, see below); spawns internal generation in parallel (prefetch)
  ↓
[auto-filter]          — analyze select-agent runs automatically
  ↓
scope-gate             — single human review gate: confirm AI selection, toggle components
  ↓
credentials            — operator reviews the prefilled space-id / env / token (internal generation is already running)
                         press [s] Skip to save-only without pushing
  ↓
final-review           — minimum-viable port of the JsonEditor; edit names, $description,
                         $default, $allowedComponents per slot, $values, source/rationale panels
  ↓
preview                — diff vs. live Contentful
  ↓
push-decision-gate     — choose Save AND push (default) or one of the alternatives
  ↓
pushing → done         — push emits a Contentful webapp view URL for the imported components
```

There is now a single human review gate (`scope-gate`) before generation; the legacy two-step extract-review + select-review flow has been collapsed.

### Configurable AI auto-filter

The auto-filter (`analyze select-agent` invoked before scope-gate) is on by default; the value selected in setup is persisted to `credentials.json` so subsequent runs default to your saved preference.

### Save-and-push default

The push-decision-gate defaults to **save AND push**: it writes `components.json` and `tokens.json` to disk *and* pushes to Contentful in one step.

### Replaying prior runs

After every successful wizard session, the CLI appends a record to `~/.config/experiences/runs.json` and prints a teaser pointing at the run-id. Subsequent invocations can reuse that record:

| Flag                              | What it does                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |

### Custom skill prompts

Custom `.md` skill prompt paths can be saved via `experiences setup`; the CLI emits a banner at agent invocation when an override is active.

### Flag reference — `experiences import`

| Flag                              | Default                                | Description                                                                                                  |
| --------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `--project <path>`                | `.`                                    | Project root to analyze                                                                                      |
| `--out <path>`                    | `<project>/.contentful`                | Headless-mode output directory                                                                               |
| `--agent <name>`                  | saved by setup / `claude`              | Agent for `analyze select-agent` and internal generation                                                     |
| `--model <name>`                  | agent default                          | Model name                                                                                                   |
| `--atomic`                        | **default**                            | Flat import, no embedded-component hierarchy (composition stripped on push)                                   |
| `--composite`                     | —                                      | Import the embedded-component hierarchy (any composition flag implies this)                                   |
| `--composition-map <path>`        | —                                      | Consume a hand-authored parent→children interchange map (implies `--composite`)                              |
| `--generate-map <path>`           | —                                      | Also write a composition-map skeleton from the resolved composition (implies `--composite`)                  |
| `--composition-agent`             | —                                      | Opt into agentic resolution when deterministic sources find no groups (implies `--composite`)                |
| `--composition-refresh`           | —                                      | Bypass the composition cache and re-resolve from scratch, forcing the agent to run (implies `--composite`)   |
| `--prompt <stage=value>`          | —                                      | Override a stage prompt (repeatable); value is a file path or literal text, e.g. `--prompt composition=./p.md` |
| `--skip-map-tokens`               | —                                      | Skip the `map tokens` step between internal generation and apply                                             |
| `--no-cache`                      | cache on                               | Bypass extract/select/internal-generation/map-tokens fine-grained caches and force re-run                    |
| `--host <url>`                    | `https://api.contentful.com`           | Override API base URL                                                                                        |

### Run-picker at wizard start

### `--model` and `--agent` overrides

`--model <name>` overrides the stored model for this run. The resolution order is:

1. `--model <name>` flag
2. `model` field saved in `~/.config/experiences/credentials.json`
3. Built-in default for the chosen agent

`--agent <name>` works the same way and is a fully functional wizard override — earlier releases plumbed the flag but the commander default shadowed it; the flag now wins over the saved value as expected.

---

## `experiences runs`

List recorded wizard runs from `~/.config/experiences/runs.json`, or print the detail view for a single run.

```bash
experiences runs [<id-or-path>] [--project <path>] [--limit <n>] [--pushed | --not-pushed] [--json]
```

| Option              | Description                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `<id-or-path>`      | Positional. Print the detail view for a single run by id or recorded save path. Path resolution sniffs for `/`, `./`, or `~/` prefix (and the bare `.` / `~` values) via `resolveRunTarget()`. |
| `--project <path>`  | Filter by source project path (absolute).                                                |
| `--limit <n>`       | Cap the number of rows printed.                                                          |
| `--pushed`          | Show only runs that were pushed to Contentful. Mutex with `--not-pushed`.                |
| `--not-pushed`      | Show only runs that were never pushed. Mutex with `--pushed`.                            |
| `--json`            | Emit machine-readable output: `RunRecord[]` for the list view; a single `RunRecord` object when combined with `<id-or-path>`. |

Each row prints the run id, creation time, project path, save path, component count, and push target (or `(not pushed)`). Table columns auto-expand to fit content — long project / save paths are no longer truncated.

Use `experiences runs` to inspect prior session records.

---

## Standalone subcommands

The standalone subcommands below are pinned by snapshot test (`test/analyze/select-flags.test.ts` and friends) and remain backwards-compatible. The wizard internally calls these same commands.

### `analyze extract`

Extract component definitions from a project source tree.

```bash
experiences analyze extract --project <path> [--dir <src-dir>] [composition flags]
```

| Option | Default | Description |
|---|---|---|
| `--project <path>` | _(required)_ | Path to the project root |
| `--dir <path>` | `src` (falls back to project root) | Source directory relative to project root |
| `--resolve-unreachable <mode>` | `auto` | Retry pass for unresolved Svelte `Props` types: `auto`, `always`, or `never` |
| `--atomic` | **default** | Skip composition resolution — flat components only |
| `--composite` | — | Resolve embedded-component composition (any composition flag implies this) |
| `--composition-map <path>` | — | Consume a hand-authored parent→children interchange map (implies `--composite`) |
| `--generate-map <path>` | — | Write a skeleton interchange map from the resolved composition (implies `--composite`) |
| `--composition-agent` | — | Opt into agentic resolution when deterministic sources find no groups (implies `--composite`) |
| `--composition-refresh` | — | Bypass the composition cache and re-resolve from scratch, forcing the agent to run (implies `--composite`) |
| `--agent <name>` | saved by setup | Coding agent for composition resolution: `claude`, `codex`, `opencode`, `cursor`, `copilot` |
| `--prompt <stage=value>` | — | Override a stage prompt (repeatable); value is a file path or literal text, e.g. `--prompt composition=./p.md` |

Scans `.tsx`, `.ts`, `.jsx`, `.js`, `.vue`, and `.astro` files. Ignores `node_modules`, `dist`, `build`, `.next`, `.nuxt`, `coverage`, `storybook-static`, `out`, `demo(s)`, and `example(s)` directories. Also ignores `*.stories.*`, `*.story.*`, `*.spec.*`, and `*.test.*` files.

Writes extracted components to the session database and prints `session=<id>` to stdout. In an interactive terminal, a scrollable TUI displays the extraction summary; press `q` or `Enter` to exit.

The deterministic non-authorable filter drops infrastructure components with no authoring surface (Context providers, refs-only wrappers, etc.); each drop is reported as a warning so the operator can audit.

Extraction is **atomic by default** — flat components, no embedded hierarchy. See [Composite components & composition](#composite-components--composition) for how `--composite` and the composition flags resolve parent→child relationships.

---

### `analyze select`

Standalone JsonEditor TUI for picking which components to include. Alias: `analyze edit`. **Untouched by the wizard rebuild** — the rich full-screen editor remains the way to operate outside the wizard.

```bash
experiences analyze select [--session <id>] [--project-root <path>]
```

| Option | Default | Description |
|---|---|---|
| `--session <id>` | most recent completed `analyze extract` | Session ID from `analyze extract` |
| `--project-root <path>` | `cwd` | Project root for resolving component source files |
| `--select-all` | — | Select all components without launching the TUI |
| `--select <pattern>` | — | Select components whose name contains pattern (repeatable) |
| `--deselect <pattern>` | — | Deselect components whose name contains pattern (repeatable) |
| `--accept-all` | — | Alias for `--select-all` |
| `--reject <pattern>` | — | Alias for `--deselect <pattern>` (repeatable) |
| `--patch <path>` | — | Path to a JSON patch file for structured overrides |
| `--exclude-invalid` | — | With `--select-all`: auto-reject components with validation errors |
| `--exclude-components <names>` | — | Comma-separated names to force-reject regardless of other flags |

Without any non-interactive flag, launches a full-screen TUI requiring 60+ columns. Keyboard reference and patch-file format are unchanged from prior releases.

---

### `analyze select-agent`

Use an AI agent to decide which extracted components belong in Contentful Experience Orchestration. Runs one agent invocation per component at configurable concurrency.

```bash
experiences analyze select-agent [--agent <name>] [--session <id>]
```

| Option | Default | Description |
|---|---|---|
| `--agent <name>` | saved by `experiences setup` | Agent: `claude`, `codex`, `opencode`, `cursor`, or `copilot` |
| `--session <id>` | most recent completed `analyze extract` | Session ID from `analyze extract` |
| `--project-root <path>` | `cwd` | Project root for resolving component source files |
| `--model <name>` | agent default | Model to use |
| `--verbose` | — | Show full agent output including reasoning text |
| `--dry-run` | — | Print the prompt for the first component without invoking the agent |
| `--select-prompt-path <path>` | saved by setup | Custom `.md` skill prompt (bypasses bundled invariants); emits a banner at invocation |
| `--no-select-cache` | cache on | Skip the per-component select cache and re-LLM every component |
| `--no-cache` | cache on | Skip all fine-grained caches (extract, select, generate) |
| `--show-rationale` | — | Read-only mode. Print the recorded accept / reject rationale for every component in the session and exit. Reads `raw_components.reject_reason` from the pipeline DB — no LLM call, no schema change. |
| `--json` | — | With `--show-rationale`: emit the rationale rows as JSON for scripting. |

Decisions are written to the same review state file used by `analyze select`, so the import wizard's generation step picks them up automatically. Each `(component-hash, prompt-hash, cli-version)` triple is cached; changing the prompt file via `--select-prompt-path` already busts the corresponding cache entries.

`--show-rationale` is a separate read-only mode — it does not invoke the agent and is safe to run against a completed session at any time. Pair with `--session <id>` to target a specific session; otherwise it auto-resolves to the most recent completed `analyze extract`.

### `print components` / `print tokens` / `print validate`

Unchanged from prior releases.

```bash
experiences print components [--session <id>] [--out <path>]
experiences print tokens     [--session <id>] [--out <path>]
experiences print validate   [--components <path>] [--tokens <path>]
```

`print validate` exits `0` on success, `1` on validation errors.

---

### `apply push`

These subcommands are the non-wizard route to the same diff and push logic. Flag surfaces are unchanged.

`apply push` emits a Contentful webapp view URL for the imported components in its JSON summary (`viewUrl`) so callers can deep-link into the management UI after a successful push.

```bash
experiences apply push    --space-id <id> --environment-id <env> --session <id> [--yes]
```

Shared flags: `--components`, `--tokens`, `--session`, `--space-id`, `--environment-id`, `--cma-token`, `--host`, `--viewports`. `apply push` adds `--yes`, `--verbose`, `--force`, `--dry-run`, `--allow-deletions`. By default, remote ComponentTypes and DesignTokens missing from the pushed manifest are skipped, not deleted; pass `--allow-deletions` to restore the prior delete behavior.

Design tokens are written first (component types may reference token kinds). Each entity write is recorded in the session database atomically — interrupted pushes resume from where they left off.

---

### `session list` / `session show` / `session stats` / `session prune`

Lower-level pipeline-session management. Unchanged from prior releases; see `experiences session --help` for the full flag surface. Most operators should use `experiences runs` instead.

---

## Session Database

All pipeline state is stored in `~/.contentful/experience-design-system-cli/pipeline.db` (SQLite). The path can be overridden with the `EDS_PIPELINE_DB_PATH` environment variable. The push-resumption database is at `~/.contentful/experience-design-system-cli/import.db` (override with `EDS_IMPORT_DB_PATH`).

Wizard run history is separate: `~/.config/experiences/runs.json`.

---

## Terminal Compatibility

- Minimum 60 columns required for the wizard and the `analyze select` TUI
- 80+ columns recommended for full sidebar + detail view
- 120+ columns required to show the source code panel in `analyze select`
- `NO_COLOR=1` suppresses all ANSI color output
- Interactive views require both stdin and stdout to be TTYs and stdin to support raw mode. Read-only views fall back to plain or JSON output when those capabilities are unavailable; commands that require input stop with the relevant non-interactive flags in the error message.
- On Windows, use Windows Terminal with PowerShell. Older ConEmu and cmd.exe hosts may not provide the raw-mode support the interactive UI needs.
- To avoid the interactive UI, use `import` with credentials, and use `apply push --yes` for a non-interactive push.

---

## Usage data

The CLI collects **anonymous usage data** to help us understand which commands are used and where the import workflow succeeds or fails. This data does **not** include your source code, file paths, credentials, prompts, or any content you author.

What may be included:

- Command name and duration
- CLI, Node.js, and operating-system version
- Anonymous session identifiers that link steps within a single import run
- Structural counts (for example, how many components were extracted or accepted)
- Space and environment IDs you pass on the command line
- Contentful request IDs from API responses (to correlate failures with server logs)

You can turn this off two ways:

- Persistently: run `experiences setup` and answer "yes" at the analytics prompt. This writes an opt-out to `~/.config/experiences/credentials.json` that persists across invocations until you change it again — it will not silently re-enable itself.
- Per invocation:

  ```bash
  DISABLE_ANALYTICS=1 experiences import --project ./my-app
  ```

  Setting `DISABLE_ANALYTICS` to any value disables collection for that invocation. This is additive with the persisted opt-out — it can only disable, never re-enable, collection that setup has turned off.

---

## Development

```bash
# Install dependencies from repo root
pnpm install

# Build
pnpm -F @contentful/experience-design-system-cli build

# Run tests
pnpm -F @contentful/experience-design-system-cli test

# Typecheck
pnpm -F @contentful/experience-design-system-cli typecheck
```

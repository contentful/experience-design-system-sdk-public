# @contentful/experience-design-system-cli

CLI for extracting, reviewing, generating, validating, and pushing Contentful Experience Design System component definitions.

## Pipeline Overview

The commands form a pipeline. Run them in order, or use `import` to orchestrate the whole thing at once:

```
analyze extract   →   analyze select-agent   →   generate components   →   apply push
```

`analyze select-agent` uses an AI agent to decide which extracted components belong in Contentful Experience Orchestration. You can substitute it with `analyze select` for manual/pattern-based selection.

**Determinism boundary.** `analyze extract` is fully deterministic: ts-morph AST parsing produces the same component list and prop shape on every run, then a deterministic pre-classifier and a structural non-authorable filter (see below) shape the output. AI enters the pipeline at `analyze select-agent` and `generate components`, where coding agents make per-component decisions. This split keeps the extracted artifact reproducible and inspectable — if an extracted component looks wrong, the cause is in the rules, not in agent variability.

All intermediate data flows through a local SQLite session database (`~/.contentful/experience-design-system-cli/pipeline.db`). No JSON files are written between steps — each command reads its inputs from the session and writes its outputs back to it. Use `print` to export session data to JSON files on demand (e.g. for inspection or manual validation).

---

## Prerequisites

### Coding agent

`generate components` (and `generate tokens`) requires a coding agent CLI in your `$PATH`. Choose one:

| Agent | Install | Auth |
|---|---|---|
| **Claude Code** (`claude`) | `npm install -g @anthropic-ai/claude-code` | `claude login` (browser OAuth) **or** set `ANTHROPIC_API_KEY` |
| **OpenAI Codex** (`codex`) | `npm install -g @openai/codex` | Set `OPENAI_API_KEY` |
| **OpenCode** (`opencode`) | `npm install -g opencode-ai` | Configure via `opencode auth` (supports multiple providers) |
| **Cursor** (`cursor`) | Install [Cursor](https://cursor.com) | Sign in to Cursor; exposes `cursor-agent` binary |

The CLI invokes the agent non-interactively in a subprocess. If the binary is not found in `$PATH`, the command exits 1 and prints manual fallback instructions.

### Contentful credentials

`apply preview`, `apply select`, `apply push`, and `import` require access to a Contentful space. Set these environment variables (or pass the equivalent flags):

```bash
export CONTENTFUL_MANAGEMENT_TOKEN=<your-cma-token>   # required
export CONTENTFUL_SPACE_ID=<your-space-id>             # required
export CONTENTFUL_ENVIRONMENT_ID=master                # required
```

**Option A — Contentful CLI:**

```bash
npm install -g contentful-cli
contentful login   # opens browser OAuth flow; token is stored in ~/.contentfulrc.json
```

After logging in, retrieve the token:

```bash
# Prints the stored token
contentful login

# Or read it directly
cat ~/.contentfulrc.json
```

**Option B — Contentful web app:**

Settings → API keys → Content management tokens → Generate personal token.

Once you have the token, export it:

```bash
export CONTENTFUL_MANAGEMENT_TOKEN=<your-cma-token>
```

Alternatively, pass `--cma-token`, `--space-id`, and `--environment-id` directly on each command.

---

## Commands

### `analyze extract`

Extract component definitions from a project source tree.

```bash
experience-design-system-cli analyze extract --project <path> [--dir <src-dir>]
```

| Option | Default | Description |
|---|---|---|
| `--project <path>` | _(required)_ | Path to the project root |
| `--dir <path>` | `src` (falls back to project root) | Source directory relative to project root |

Scans `.tsx`, `.ts`, `.jsx`, `.js`, `.vue`, and `.astro` files. Ignores `node_modules`, `dist`, `build`, `.next`, `.nuxt`, `coverage`, `storybook-static`, and `out` directories. Also ignores `*.stories.*`, `*.story.*`, `*.spec.*`, and `*.test.*` files.

Writes extracted components to the session database and prints `session=<id>` to stdout. In an interactive terminal, a scrollable TUI displays the extraction summary (including a warning for any components with 0 props and 0 slots); press `q` or `Enter` to exit.

#### Non-authorable component filter

Before storing components, `analyze extract` runs a deterministic filter that drops infrastructure components which have no authoring surface (Context providers, analytics shims, security utilities, layout helpers). The filter uses prop-shape signals only — no component-name or source-path patterns — so it works regardless of how a host repo organizes its design system. A component is dropped if **any** of:

1. Zero props and zero slots.
2. Source calls `createContext()` and the component has a prop literally named `value`.
3. Source calls `createContext()` and the component has zero props.
4. Source calls `createContext()` and the component has exactly one non-handler prop.
5. Every prop is a handler or ref (function-typed, `EventHandler`, `Dispatch`, `SetStateAction`, `Ref<>`, name starts with `on`/`set`, or named `ref`/`innerRef`).

Each dropped component is reported as a warning (`Skipped non-authorable component: <Name> (<reason>)`) so the operator can audit. The rule set was selected via Monte-Carlo evaluation against a hand-labelled corpus to maximize precision (zero false positives) over recall — components that look like normal authoring surface but are actually infrastructure are deferred to the AI selection stage rather than dropped here.

---

### `analyze select`

Interactively select components for generation and optionally patch their definitions. Alias: `analyze edit`.

```bash
experience-design-system-cli analyze select [--session <id>] [--project-root <path>]
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

Without `--select-all`, `--select`, `--deselect`, or `--patch`, launches a full-screen TUI (requires 60+ columns). With any non-interactive flag, exits immediately after applying decisions.

#### Keyboard Reference

| Key | Action |
|---|---|
| `↑` / `k` | Navigate up |
| `↓` / `j` | Navigate down |
| `Tab` | Toggle focus between sidebar and main panel |
| `a` | Accept selected component |
| `r` | Reject selected component |
| `e` | Enter edit mode for selected component |
| `s` | Toggle source code panel (requires 120+ cols) |
| `A` | Approve all unreviewed components |
| `F` | Open finalize dialog |
| `q` | Quit (prompts if unsaved edits) |
| `?` | Toggle help overlay |

**In edit mode:**

| Key | Action |
|---|---|
| Arrow keys | Move cursor |
| `Ctrl+S` | Save edits (validates JSON) |
| `Ctrl+Z` | Undo |
| `Esc` | Discard changes |

#### Patch file format

`--patch` accepts a JSON array of operations. Each operation targets a component by name:

```json
[
  { "component": "Button", "status": "accepted" },
  { "component": "Input", "status": "rejected" },
  { "component": "Card", "set": { "props[name=variant].type": "string" } }
]
```

`set` paths support dot notation and array item matching with `[name=value]` predicates.

#### Session resume

The review session is persisted in `~/.contentful/experience-design-system-cli/`. If the TUI is interrupted, re-running with the same `--session` resumes where you left off.

---

### `analyze select-agent`

Use an AI agent to decide which extracted components belong in Contentful Experience Orchestration as Component Types. Accepts any component that renders visible UI (atoms, molecules, and organisms are all valid) and rejects non-visual infrastructure: React hooks, context providers, A/B testing or variant-routing wrappers, analytics trackers, and security utilities. Runs one agent invocation per component at configurable concurrency, mirroring how `generate components` works.

```bash
experience-design-system-cli analyze select-agent --agent claude [--session <id>]
```

| Option | Default | Description |
|---|---|---|
| `--agent <name>` | _(required)_ | Agent to use: `claude`, `codex`, `opencode`, or `cursor` |
| `--session <id>` | most recent completed `analyze extract` | Session ID from `analyze extract` |
| `--project-root <path>` | `cwd` | Project root for resolving component source files |
| `--model <name>` | agent default | Model to use (defaults to a small/fast model per agent) |
| `--verbose` | — | Show full agent output including reasoning text |
| `--dry-run` | — | Print the prompt for the first component without invoking the agent |

Results are written to the same session state file used by `analyze select`, so `generate components` will pick up the decisions automatically. If you want to review or override the agent's selections, run `analyze select --session <id>` after `select-agent` completes.

---

### `generate components`

Invoke a coding agent to generate CDF component definitions from raw analysis output. Results are stored in the session database and passed directly to `apply` commands via `--session`. Use `print components` to export them to a JSON file on demand.

```bash
experience-design-system-cli generate components --agent claude [--session <id>]
```

| Option | Default | Description |
|---|---|---|
| `--agent <name>` | _(required)_ | Agent to use: `claude`, `codex`, `opencode`, or `cursor` |
| `--session <id>` | most recent completed `analyze extract` | Session ID from `analyze extract` |
| `--tokens <path>` | — | Path to `tokens.json` for token-linked prop resolution (optional) |
| `--token-map <path>` | — | Path to `token-name-map.json` sidecar (optional) |
| `--model <name>` | agent default | Model to use (defaults to a small/fast model per agent) |
| `--dry-run` | — | Print the prompt without invoking the agent |

Raw components are loaded from the session database and embedded directly in the prompt — no intermediate file is read. On success, generated CDF components are written back to the session database and `session=<id>` is printed to stdout.

**Autonomous mode** (default): the agent runs non-interactively, prints its result between `<<<EDS_OUTPUT_START>>>` / `<<<EDS_OUTPUT_END>>>` sentinel markers, and the CLI stores the validated CDF in the session database.

If the agent binary is not found in `$PATH`, the command exits 1 and prints manual fallback instructions including the skill file path.

---

### `generate components edit`

Review and correct the output of `generate components` before pushing.

```bash
experience-design-system-cli generate components edit [--session <id>]
```

| Option | Default | Description |
|---|---|---|
| `--session <id>` | most recent active session | Session ID to operate on |
| `--accept-all` | — | Accept all definitions without launching the TUI |
| `--reject <pattern>` | — | Reject definitions whose name contains pattern (repeatable) |
| `--patch <path>` | — | Path to a JSON patch file for structured overrides |

---

---

### `generate tokens`

Invoke a coding agent to generate DTCG design tokens from raw token data. Results are stored in the session database and passed directly to `apply` commands via `--session`. Use `print tokens` to export them to a JSON file on demand.

```bash
experience-design-system-cli generate tokens --agent claude [--raw-tokens <path>]
```

| Option | Default | Description |
|---|---|---|
| `--agent <name>` | _(required)_ | Agent to use: `claude`, `codex`, `opencode`, or `cursor` |
| `--raw-tokens <path>` | — | Path to raw token input file |
| `--model <name>` | agent default | Model to use (defaults to a small/fast model per agent) |
| `--dry-run` | — | Print the prompt without invoking the agent |

---

### `generate tokens edit`

Review and correct the output of `generate tokens` before pushing.

```bash
experience-design-system-cli generate tokens edit [--session <id>]
```

Accepts the same flags as `generate components edit`.

---

### `print components`

Write generated CDF component definitions from the session database to a JSON file.

```bash
experience-design-system-cli print components [--session <id>] [--out <path>]
```

| Option | Default | Description |
|---|---|---|
| `--session <id>` | most recent completed `generate components` session | Session ID to read from |
| `--out <path>` | `components.json` | Output file path |

Exits 1 if no generated components exist for the session.

---

### `print tokens`

Write generated DTCG design tokens from the session database to a JSON file.

```bash
experience-design-system-cli print tokens [--session <id>] [--out <path>]
```

| Option | Default | Description |
|---|---|---|
| `--session <id>` | most recent completed `generate tokens` session | Session ID to read from |
| `--out <path>` | `tokens.json` | Output file path |

Reconstructs the full DTCG nested tree (groups + leaf tokens) from the normalized session storage. Exits 1 if no generated tokens exist for the session.

---

### `print validate`

Validate CDF component definitions and/or DTCG token files against their schemas.

```bash
experience-design-system-cli print validate [--components <path>] [--tokens <path>]
```

| Option | Description |
|---|---|
| `--components <path>` | Path to a CDF component JSON file |
| `--tokens <path>` | Path to a DTCG token JSON file |

At least one flag is required. In an interactive terminal, a scrollable TUI displays validation results. Exit code: `0` if all files are valid, `1` if any errors are found.

---

### `apply preview`

Show a read-only diff of what `apply push` would do.

```bash
experience-design-system-cli apply preview \
  --space-id $CONTENTFUL_SPACE_ID \
  --environment-id master \
  --session <id>
```

At least one of `--session`, `--components`, or `--tokens` is required. `--session` and `--components` are mutually exclusive.

| Option | Default | Description |
|---|---|---|
| `--session <id>` | — | Session ID from `generate components` (reads components from session DB) |
| `--components <path>` | — | Path to a CDF `components.json` file (alternative to `--session`) |
| `--tokens <path>` | — | Path to a DTCG `tokens.json` file |
| `--space-id <id>` | _(required)_ | Contentful space ID |
| `--environment-id <id>` | _(required)_ | Contentful environment ID |
| `--cma-token <token>` | `CONTENTFUL_MANAGEMENT_TOKEN` env | CMA personal access token or app token |
| `--viewports <path>` | single catch-all viewport | JSON file with a viewport array applied to every imported component type |
| `--host <url>` | `https://api.contentful.com` | Override API base URL |
| `--include-unchanged` | — | Include unchanged entities in non-interactive JSON output |

In interactive mode, renders a two-level TUI: a summary view listing entities by status (new / changed / unchanged / conflict), with `Enter` to expand into a property-level diff view. In non-interactive mode, writes a structured JSON diff to stdout. Exit code: `0` if the diff is clean, `1` if there are kind conflicts that would block the push.

---

### `apply select`

Choose a subset of entities to push. Opens a checkbox TUI after computing the diff, or use non-interactive flags.

```bash
experience-design-system-cli apply select \
  --space-id $CONTENTFUL_SPACE_ID \
  --environment-id master \
  --session <id>
```

Accepts the same flags as `apply preview` (except `--include-unchanged`), plus:

| Option | Default | Description |
|---|---|---|
| `--select-all` | — | Select all entities without launching TUI |
| `--select <pattern>` | — | Select entities by ID pattern (repeatable) |
| `--deselect <pattern>` | — | Deselect entities by ID pattern (repeatable) |

**Default TUI selection:** entities with status `new` or `changed` are pre-selected; `unchanged` and `kindConflict` start unchecked.

**Keyboard map (TUI):**

| Key | Action |
|---|---|
| `↑` / `↓` | Move cursor |
| `Space` | Toggle entity |
| `A` | Select all |
| `N` | Deselect all |
| `I` | Push selected entities |
| `Q` | Quit without pushing |

---

### `apply push`

Write component types and design tokens to Contentful ExO.

```bash
experience-design-system-cli apply push \
  --space-id $CONTENTFUL_SPACE_ID \
  --environment-id master \
  --session <id>
```

Accepts the same flags as `apply preview` (except `--include-unchanged`), plus:

| Option | Default | Description |
|---|---|---|
| `--yes` | — | Skip interactive confirmation (required in non-TTY mode) |

Design tokens are written first (component types may reference token kinds). Each entity write is recorded in the session database atomically — if the push is interrupted, re-running with the same flags resumes from where it left off, skipping already-succeeded entities.

#### Viewport configuration

By default every imported component type gets a single catch-all viewport:

```json
[{ "id": "all", "query": "*", "displayName": "All Sizes", "previewSize": "100%" }]
```

To apply a custom set, pass `--viewports <path>` with a JSON array of objects containing `id`, `query`, `displayName`, and `previewSize`.

---

### `import`

Run the full pipeline in one command: analyze → select-agent → generate → push.

```bash
experience-design-system-cli import \
  --space-id $CONTENTFUL_SPACE_ID \
  --environment-id master \
  --cma-token $CONTENTFUL_MANAGEMENT_TOKEN \
  --project <path> \
  --agent claude
```

Contentful credentials (`--space-id`, `--environment-id`, `--cma-token`) are only required when the apply step runs. Pass `--skip-apply` to run the pipeline without pushing to Contentful.

The select step uses `analyze select-agent` by default, letting the agent decide which components belong in Experience Orchestration. Pass `--select-all`, `--select`, or `--deselect` to override with pattern-based selection instead. To review and select components interactively, run the steps manually rather than using `import`.

| Option | Default | Description |
|---|---|---|
| `--space-id <id>` | _(required unless `--skip-apply`)_ | Contentful space ID |
| `--environment-id <id>` | _(required unless `--skip-apply`)_ | Contentful environment ID |
| `--cma-token <token>` | `CONTENTFUL_MANAGEMENT_TOKEN` env | CMA personal access token or app token |
| `--project <path>` | `.` | Path to the project root to analyze |
| `--out <path>` | `<project>/.contentful` | Directory where `components.json` is written when `--print` is set |
| `--agent <name>` | `claude` | Agent to use for `analyze select-agent` and `generate components` |
| `--model <name>` | agent default | Model to use for agent steps |
| `--select-all` | — | Skip agentic select; accept all extracted components |
| `--select <pattern>` | — | Skip agentic select; accept components matching pattern (repeatable) |
| `--deselect <pattern>` | — | Skip agentic select; deselect components matching pattern (repeatable) |
| `--skip-analyze` | — | Skip analyze; use most recent `analyze extract` session |
| `--skip-generate` | — | Skip generate; use most recent `generate components` session |
| `--print` | — | Write `components.json` to `--out` after generation |
| `--skip-apply` | — | Skip pushing to Contentful (stops after generate) |
| `--no-cache` | — | Re-run all steps even if output already exists |
| `--yes` | — | Skip interactive confirmation in `apply push` |
| `--viewports <path>` | — | JSON file with viewport array (passed to `apply push`) |
| `--host <url>` | — | Override API base URL (passed to `apply push`) |
| `--dry-run` | — | Print the generate prompt without invoking the agent |

---

### `session list`

List all pipeline sessions.

```bash
experience-design-system-cli session list [--status <status>] [--limit <n>] [--json]
```

| Option | Default | Description |
|---|---|---|
| `--status <status>` | — | Filter by `in-progress`, `complete`, `failed`, or `interrupted` |
| `--all` | — | Include interrupted sessions (hidden by default) |
| `--limit <n>` | `20` | Max rows to return |
| `--json` | — | Force JSON output |

---

### `session show <id>`

Show all steps for a session.

```bash
experience-design-system-cli session show <id> [--json]
```

---

### `session stats`

Show aggregate storage and record counts for the pipeline database.

```bash
experience-design-system-cli session stats [--json]
```

---

### `session prune`

Delete sessions matching criteria.

```bash
experience-design-system-cli session prune --older-than 30d [--dry-run] [--yes]
```

| Option | Description |
|---|---|
| `--id <id>` | Delete a specific session by ID |
| `--older-than <duration>` | Delete sessions older than this age (e.g. `30d`, `2w`, `1y`) |
| `--status <status>` | Delete sessions by last step status: `complete`, `failed`, `interrupted` |
| `--yes` | Skip confirmation prompt |
| `--dry-run` | Print what would be deleted without deleting |

At least one of `--id`, `--older-than`, or `--status` is required.

---

## Session Database

All pipeline state is stored in `~/.contentful/experience-design-system-cli/pipeline.db` (SQLite). The path can be overridden with the `EDS_PIPELINE_DB_PATH` environment variable.

Sessions are created by `analyze extract` and shared across all downstream commands. Use `session list` to see active sessions and `session prune` to clean up old ones.

---

## Terminal Compatibility

- Minimum 60 columns required for `analyze edit` interactive mode
- 80+ columns recommended for full sidebar + detail view
- 120+ columns required to show the source code panel
- `NO_COLOR=1` suppresses all ANSI color output
- Windows: supported via Ink v4; known limitations with older ConEmu and cmd.exe

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


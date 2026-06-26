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

1. **`experiences import`** — the wizard. Drives the full pipeline (extract → AI select → scope-gate → generate → final-review → save/push) from a single command. Works in two modes: a full-screen interactive TUI in a real terminal, and a non-interactive headless mode when you pass `--auto-accept-scope` plus credentials. **This is the recommended path for almost everyone.**

2. **Standalone subcommands** — for piping into other tools, CI parity with the wizard, or for debugging individual steps:

   ```
   analyze extract   →   analyze select-agent   →   generate components   →   apply push
   ```

   `analyze select-agent` is the agent-driven selection step the wizard uses. You can replace it with `analyze select` for the older manual JsonEditor TUI.

**Determinism boundary.** `analyze extract` is fully deterministic: ts-morph AST parsing produces the same component list and prop shape on every run, then a deterministic pre-classifier and a structural non-authorable filter shape the output. AI enters the pipeline at `analyze select-agent` and `generate components`, where coding agents make per-component decisions. This split keeps the extracted artifact reproducible — if an extracted component looks wrong, the cause is in the rules, not in agent variability.

All intermediate data flows through a local SQLite session database (`~/.contentful/experience-design-system-cli/pipeline.db`). No JSON files are written between steps — each command reads its inputs from the session and writes its outputs back to it. Use `print` to export session data to JSON files on demand. The wizard additionally maintains a separate **runs.json** file (`~/.config/experiences/runs.json`) that records each successful wizard session so it can be replayed later with `--push-from-run` or `--modify`.

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

`experiences setup` persists your chosen agent (and optional model + custom prompt paths) to `~/.config/experiences/credentials.json`; later commands pick them up automatically.

### Contentful credentials

`apply preview`, `apply select`, `apply push`, and `import` (when pushing) require access to a Contentful space. Set these environment variables or pass the equivalent flags:

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

`experiences import` is the primary entry point. In a TTY it launches a full-screen wizard. In headless mode (any of `--auto-accept-scope`, `--skip-apply`, `--skip-analyze`, `--skip-generate`, `--yes`, `--dry-run`, or credential flags) it runs non-interactively. Without either, it fails loud rather than hanging.

### Wizard step machine

```
welcome
  ↓
extracting             — runs analyze extract; spawns generate in parallel (prefetch)
  ↓
[auto-filter]          — analyze select-agent runs automatically (skip with --no-auto-filter)
  ↓
scope-gate             — single human review gate: confirm AI selection, toggle components
  ↓
credentials            — operator types space-id / env / token (generate is already running)
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

The auto-filter (`analyze select-agent` invoked before scope-gate) is on by default. Override per-run with `--auto-filter` / `--no-auto-filter`; the value last selected in the wizard is persisted to `credentials.json` so subsequent runs default to your last choice.

### Save-and-push default

The push-decision-gate defaults to **save AND push**: it writes `components.json` and `tokens.json` to disk *and* pushes to Contentful in one step. Use `--no-save` to push-only or `--no-push` to save-only. `--out-dir <path>` picks the save directory non-interactively (otherwise the wizard prompts).

### Replaying prior runs

After every successful wizard session, the CLI appends a record to `~/.config/experiences/runs.json` and prints a teaser pointing at the run-id. Subsequent invocations can reuse that record:

| Flag                              | What it does                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `--push-from-run <id-or-path>`    | Re-push the recorded session to Contentful without re-opening the wizard or writing to disk. Mutually exclusive with `--modify`, `--project`, `--no-save`, `--no-push`. |
| `--modify <id-or-path>`           | Re-open the wizard at final-review with the prior run pre-populated. Pair with `--overwrite` (save back to recorded `savePath`) or `--save-as-new` (prompt for new path). |
| `--overwrite` / `--save-as-new`   | Save-mode selector for `--modify`; mutually exclusive with each other.                                                  |

Both flags accept either a run id or a filesystem path that matches a recorded `savePath`.

### Custom skill prompts

Pass `--select-prompt-path <path>` and/or `--generate-prompt-path <path>` to swap in a custom `.md` skill prompt instead of the bundled one. The CLI emits a banner at agent invocation noting the override. Paths can also be saved via `experiences setup`.

### Flag reference — `experiences import`

| Flag                              | Default                                | Description                                                                                                  |
| --------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `--space-id <id>`                 | `CONTENTFUL_SPACE_ID` env / saved      | Contentful space ID (required unless `--skip-apply` / `--no-push`)                                           |
| `--environment-id <id>`           | `CONTENTFUL_ENVIRONMENT_ID` env        | Contentful environment ID                                                                                    |
| `--cma-token <token>`             | `CONTENTFUL_MANAGEMENT_TOKEN` env      | CMA personal access token                                                                                    |
| `--project <path>`                | `.`                                    | Project root to analyze                                                                                      |
| `--out <path>`                    | `<project>/.contentful`                | Headless-mode output directory                                                                               |
| `--out-dir <path>`                | _(prompt)_                             | Save directory for `components.json` / `tokens.json`; bypasses inline save-path prompt                       |
| `--agent <name>`                  | saved by setup / `claude`              | Agent for `analyze select-agent` and `generate components`                                                   |
| `--model <name>`                  | agent default                          | Model name                                                                                                   |
| `--tokens <path>`                 | —                                      | DTCG `tokens.json` to push alongside generated components                                                    |
| `--auto-accept-scope`             | off                                    | Accept all extracted components without prompting (required for non-TTY without other headless flags)        |
| `--auto-filter` / `--no-auto-filter` | persisted in `credentials.json`     | Force AI auto-filter on or off; overrides saved preference                                                   |
| `--no-live-preview`               | live preview on                        | Skip the automatic preview re-run after each FieldEditor save                                                |
| `--no-push`                       | push on                                | Run extract → scope-gate → generate → final-review and exit without pushing                                  |
| `--no-save`                       | save on                                | Push without writing `components.json` / `tokens.json` to disk                                               |
| `--push-from-run <id-or-path>`    | —                                      | Re-push a prior run; never writes to disk                                                                    |
| `--modify <id-or-path>`           | —                                      | Re-open the wizard at final-review with a prior run loaded                                                   |
| `--overwrite`                     | —                                      | With `--modify`: save back to recorded `savePath`                                                            |
| `--save-as-new`                   | —                                      | With `--modify`: always save to a new path                                                                   |
| `--select-prompt-path <path>`     | saved by setup                         | Custom `.md` skill prompt for `analyze select-agent`                                                         |
| `--generate-prompt-path <path>`   | saved by setup                         | Custom `.md` skill prompt for `generate components`                                                          |
| `--select-all`                    | —                                      | Headless: accept all extracted components (bypasses agentic select)                                          |
| `--select <pattern>`              | —                                      | Headless: accept components matching pattern (repeatable; bypasses agentic select)                           |
| `--deselect <pattern>`            | —                                      | Headless: reject components matching pattern (repeatable; bypasses agentic select)                           |
| `--skip-analyze`                  | —                                      | Reuse most recent `analyze extract` session                                                                  |
| `--skip-generate`                 | —                                      | Reuse most recent `generate components` session                                                              |
| `--print`                         | —                                      | Headless: write `components.json` to `--out` after generation                                                |
| `--skip-apply`                    | —                                      | Stop after generate; do not push                                                                             |
| `--no-cache`                      | cache on                               | Bypass extract/select/generate fine-grained caches and force re-run; forwarded to `analyze select-agent` and `generate components` |
| `--yes`                           | —                                      | Skip interactive confirmation in `apply push`                                                                |
| `--verbose`                       | —                                      | Show full agent output and all entity progress                                                               |
| `--exclude-invalid`               | off (fail loud)                        | Auto-reject components with validation errors instead of refusing to proceed                                 |
| `--viewports <path>`              | catch-all viewport                     | JSON file with viewport array (passed to `apply push`)                                                       |
| `--host <url>`                    | `https://api.contentful.com`           | Override API base URL                                                                                        |
| `--dry-run`                       | —                                      | Print the generate prompt without invoking the agent                                                         |

---

## `experiences runs`

List recorded wizard runs from `~/.config/experiences/runs.json`.

```bash
experiences runs [--project <path>] [--limit <n>]
```

| Option              | Description                                  |
| ------------------- | -------------------------------------------- |
| `--project <path>`  | Filter by source project path (absolute)     |
| `--limit <n>`       | Cap the number of rows printed               |

Each row prints the run id, creation time, project path, save path, component count, and push target (or `(not pushed)`). Pair with `--push-from-run` or `--modify` on `experiences import` to replay a row.

---

## Standalone subcommands

The standalone subcommands below are pinned by snapshot test (`test/analyze/select-flags.test.ts` and friends) and remain backwards-compatible. The wizard internally calls these same commands.

### `analyze extract`

Extract component definitions from a project source tree.

```bash
experiences analyze extract --project <path> [--dir <src-dir>]
```

| Option | Default | Description |
|---|---|---|
| `--project <path>` | _(required)_ | Path to the project root |
| `--dir <path>` | `src` (falls back to project root) | Source directory relative to project root |

Scans `.tsx`, `.ts`, `.jsx`, `.js`, `.vue`, and `.astro` files. Ignores `node_modules`, `dist`, `build`, `.next`, `.nuxt`, `coverage`, `storybook-static`, `out`, `demo(s)`, and `example(s)` directories. Also ignores `*.stories.*`, `*.story.*`, `*.spec.*`, and `*.test.*` files.

Writes extracted components to the session database and prints `session=<id>` to stdout. In an interactive terminal, a scrollable TUI displays the extraction summary; press `q` or `Enter` to exit.

The deterministic non-authorable filter drops infrastructure components with no authoring surface (Context providers, refs-only wrappers, etc.); each drop is reported as a warning so the operator can audit.

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
| `--agent <name>` | saved by `experiences setup` | Agent: `claude`, `codex`, `opencode`, or `cursor` |
| `--session <id>` | most recent completed `analyze extract` | Session ID from `analyze extract` |
| `--project-root <path>` | `cwd` | Project root for resolving component source files |
| `--model <name>` | agent default | Model to use |
| `--verbose` | — | Show full agent output including reasoning text |
| `--dry-run` | — | Print the prompt for the first component without invoking the agent |
| `--exclude-invalid` | — | Auto-reject components with validation errors instead of failing loud |
| `--select-prompt-path <path>` | saved by setup | Custom `.md` skill prompt (bypasses bundled invariants); emits a banner at invocation |
| `--no-select-cache` | cache on | Skip the per-component select cache and re-LLM every component |
| `--no-cache` | cache on | Skip all fine-grained caches (extract, select, generate) |

Decisions are written to the same review state file used by `analyze select`, so `generate components` picks them up automatically. Each `(component-hash, prompt-hash, cli-version)` triple is cached; changing the prompt file via `--select-prompt-path` already busts the corresponding cache entries.

---

### `generate components`

Invoke a coding agent to generate CDF component definitions. Results are stored in the session database.

```bash
experiences generate components [--agent <name>] [--session <id>]
```

| Option | Default | Description |
|---|---|---|
| `--agent <name>` | saved by setup | Agent: `claude`, `codex`, `opencode`, or `cursor` |
| `--session <id>` | most recent completed `analyze extract` | Session ID from `analyze extract` |
| `--tokens <path>` | — | Path to `tokens.json` for token-linked prop resolution |
| `--token-map <path>` | — | Path to `token-name-map.json` sidecar |
| `--model <name>` | agent default | Model to use |
| `--verbose` | — | Show full agent output |
| `--dry-run` | — | Print the prompt without invoking the agent |
| `--generate-prompt-path <path>` | saved by setup | Custom `.md` skill prompt; emits a banner at invocation |
| `--no-cache` | cache on | Bypass all fine-grained caches and force re-run |

Raw components are loaded from the session database and embedded directly in the prompt — no intermediate file is read. The agent emits one JSON tool-call object per line; per-component results (CDF body + LLM rationale + source location) are persisted to the session DB.

---

### `generate components edit` / `generate tokens edit`

Non-interactive correction of generated output via `--accept-all`, `--reject`, or `--patch`. The interactive TUI variant is not currently shipped.

---

### `generate tokens`

Same shape as `generate components`, plus `--raw-tokens <path>`.

---

### `print components` / `print tokens` / `print validate`

Unchanged from prior releases.

```bash
experiences print components [--session <id>] [--out <path>]
experiences print tokens     [--session <id>] [--out <path>]
experiences print validate   [--components <path>] [--tokens <path>]
```

`print validate` exits `0` on success, `1` on validation errors.

---

### `apply preview` / `apply select` / `apply push`

These subcommands are the non-wizard route to the same diff and push logic. Flag surfaces are unchanged.

`apply push` and `apply select` now emit a Contentful webapp view URL for the imported components in their JSON summary (`viewUrl`) so callers can deep-link into the management UI after a successful push.

```bash
experiences apply preview --space-id <id> --environment-id <env> --session <id>
experiences apply select  --space-id <id> --environment-id <env> --session <id>
experiences apply push    --space-id <id> --environment-id <env> --session <id> [--yes]
```

Shared flags: `--components`, `--tokens`, `--session`, `--space-id`, `--environment-id`, `--cma-token`, `--host`, `--viewports`. `apply preview` adds `--include-unchanged`. `apply select` adds `--select-all`, `--select`, `--deselect`, `--force`. `apply push` adds `--yes`, `--verbose`, `--force`, `--dry-run`.

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

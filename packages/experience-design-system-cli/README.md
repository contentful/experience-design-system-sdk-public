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

The CLI has two primary workflows:

1. **`experiences import`** — the wizard. Drives the full pipeline (extract → AI select → scope-gate → internal generation → final-review → save/push) from a single command in a full-screen interactive TUI. **This is the recommended path for almost everyone.**

2. **`experiences apply`** — applies generated component and token definitions to Contentful.

The import wizard owns extraction, selection, generation, validation, and apply orchestration internally; those implementation stages are not exposed as standalone commands.

All intermediate data flows through a local SQLite session database (`~/.contentful/experience-design-system-cli/pipeline.db`). No JSON files are written between steps — each pipeline step reads its inputs from the session and writes its outputs back to it.

---

## Composite components & composition

A **composite component** is one that renders other components inside it — a `Card` that slots a `Button` and an `Icon`, a `Tabs` that slots `Tab` panels. When you import composite components, the CLI can populate each slot's `$allowedComponents` so the parent→child relationships survive into Contentful.

### Atomic vs. composite

Imports are **atomic by default** — flat components, no embedded hierarchy. This is the right choice when you just want each component registered on its own. Opt into hierarchy resolution with `--composite` (or any composition flag, which implies it).

| Mode | Flag | Behavior |
|---|---|---|
| Atomic | default | Flat import; composition stripped before push |
| Composite | `--composite` | Resolve and import the parent→child hierarchy |

### How composition is resolved

Under `--composite`, relationships are resolved from the highest-confidence source available, in this precedence order:

1. **Typed slots (code)** — slots the source already declares, e.g. React `ReactElement<XProps>` / `children`, Svelte `Snippet<[XProps]>`, or an explicit `@allowedComponents` JSDoc tag. Fully deterministic; picked up automatically.
2. **Agent** — direct edge emission for codebases that encode composition in *code patterns* rather than typed slots (common in real-world design systems). It is enabled automatically in composite mode and only runs when the deterministic sources above find nothing.

When more than one source speaks to the same relationship, the higher-precedence one wins (**code slots > agent**).

### The composition agent

The composition agent emits one structured edge per relationship. The CLI validates component names and merges those edges with deterministic sources by provenance and precedence.

- `--no-cache` — ignore caches and re-resolve composition from scratch, forcing the agent to run.
- `--agent <name>` — which coding agent authors the parser (`claude`, `codex`, `opencode`, `cursor`, `copilot`).
- `--prompt composition=<file-or-text>` — override the composition stage's prompt.

Because the agent path spawns a coding agent, it adds latency and cost and is best-effort.

### Slot cycles

If the resolved graph contains a circular slot dependency (A slots B, B slots A), it is detected before push. `apply` and the wizard's push path **refuse to send a manifest with cycles**; the cycle path is reported so you can break it.

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

`apply` and `import` (when pushing) require access to a Contentful space. Set these environment variables or pass the equivalent flags:

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

`experiences import` is the primary entry point and launches a full-screen wizard in a supported interactive terminal.

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

### Custom skill prompts

Custom `.md` skill prompt paths can be saved via `experiences setup`; the CLI emits a banner at agent invocation when an override is active.

### Flag reference — `experiences import`

| Flag                              | Default                                | Description                                                                                                  |
| --------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `--project <path>`                | `.`                                    | Project root to analyze                                                                                      |
| `--agent <name>`                  | saved by setup / `claude`              | Agent for `analyze select-agent` and internal generation                                                     |
| `--model <name>`                  | agent default                          | Model name                                                                                                   |
| `--composite`                     | —                                      | Import the embedded-component hierarchy (any composition flag implies this)                                   |
| `--composition-map <path>`        | —                                      | Consume a hand-authored parent→children interchange map (implies `--composite`)                              |
| `--prompt <stage=value>`          | —                                      | Override a stage prompt (repeatable); value is a file path or literal text, e.g. `--prompt composition=./p.md` |
| `--skip-map-tokens`               | —                                      | Skip the `map tokens` step between internal generation and apply                                             |
| `--no-cache`                      | cache on                               | Bypass extract/select/internal-generation/map-tokens/composition caches and force re-run                    |

### `--model` and `--agent` overrides

`--model <name>` overrides the stored model for this run. The resolution order is:

1. `--model <name>` flag
2. `model` field saved in `~/.config/experiences/credentials.json`
3. Built-in default for the chosen agent

`--agent <name>` works the same way and is a fully functional wizard override — earlier releases plumbed the flag but the commander default shadowed it; the flag now wins over the saved value as expected.

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

### `apply`

This command is the non-wizard route to the same diff and push logic. Its flag surface is unchanged.

`apply` emits a Contentful webapp view URL for the imported components in its JSON summary (`viewUrl`) so callers can deep-link into the management UI after a successful push.

```bash
experiences apply
```

Shared flags: `--components`, `--tokens`. `apply` is interactive and loads credentials from `experiences setup` or environment variables. Remote ComponentTypes and DesignTokens missing from the pushed manifest are always skipped.

Design tokens are written first (component types may reference token kinds). Each entity write is recorded in the session database atomically — interrupted pushes resume from where they left off.

---

## Session Database

All pipeline state is stored in `~/.contentful/experience-design-system-cli/pipeline.db` (SQLite). The path can be overridden with the `EDS_PIPELINE_DB_PATH` environment variable. The push-resumption database is at `~/.contentful/experience-design-system-cli/import.db` (override with `EDS_IMPORT_DB_PATH`).

---

## Terminal Compatibility

- Minimum 60 columns required for the wizard and the `analyze select` TUI
- 80+ columns recommended for full sidebar + detail view
- 120+ columns required to show the source code panel in `analyze select`
- `NO_COLOR=1` suppresses all ANSI color output
- Interactive views require both stdin and stdout to be TTYs and stdin to support raw mode.
- On Windows, use Windows Terminal with PowerShell. Older ConEmu and cmd.exe hosts may not provide the raw-mode support the interactive UI needs.
- `experiences import` does not provide a non-interactive execution mode.

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

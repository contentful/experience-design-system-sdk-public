# @contentful/experience-design-system-cli-legacy

> **Deprecated and internal.** This package is not published. It is bundled into `@contentful/experience-design-system-cli`, which forwards the `apply`, `setup`, `doctor`, `print` and `map` commands to it until they are ported. Install and use `@contentful/experience-design-system-cli` instead.

CLI for extracting, reviewing, generating, validating, and pushing Contentful Experience Design System component definitions into Experiences.

## Binaries

The package installs three equivalent binaries:

| Binary                         | Notes                                                 |
| ------------------------------ | ----------------------------------------------------- |
| `experiences`                  | Preferred entry point — short and operator-facing     |
| `exo`                          | Shorthand for Experience Orchestration                |
| `experience-design-system-cli` | Full name; used in CI / scripts where clarity matters |

The rest of this README uses `experiences`.

## CLI Overview

The CLI has two primary workflows:

1. **`experiences import`** — the wizard. Drives the full pipeline (extract → AI select → scope-gate → generation → final-review → save and push) from a single command in a full-screen interactive TUI. **This is the recommended path for almost everyone.**

2. **`experiences apply <file>`** — applies a CDF file of component and token definitions to Contentful.

`experiences setup` and `experiences doctor` configure and check your environment. `experiences build` rebuilds a local checkout and re-links the binaries.

The import wizard owns extraction, selection, generation, validation, and apply orchestration internally; those implementation stages are not exposed as public commands. Hidden internal commands (`__extract`, `__generate`, `map tokens`, `print`) are what the wizard runs in subprocesses.

All intermediate data flows through a local SQLite session database (`~/.contentful/experience-design-system-cli/pipeline.db`). No JSON files are written between steps — each pipeline step reads its inputs from the session and writes its outputs back to it.

---

## Composite components & composition

A **composite component** is one that renders other components inside it — a `Card` that slots a `Button` and an `Icon`, a `Tabs` that slots `Tab` panels. When you import composite components, the CLI can populate each slot's `$allowedComponents` so the parent→child relationships survive into Contentful.

All imports use composite mode: embedded-component relationships are resolved and preserved in the generated CDF.

### How composition is resolved

Relationships are resolved from the highest-confidence source available, in this precedence order:

1. **Typed slots (code)** — slots the source already declares, e.g. React `ReactElement<XProps>` / `children`, Svelte `Snippet<[XProps]>`, or an explicit `@allowedComponents` JSDoc tag. Fully deterministic; picked up automatically.
2. **Agent** — direct edge emission for codebases that encode composition in _code patterns_ rather than typed slots (common in real-world design systems). It is enabled automatically in composite mode and only runs when the deterministic sources above find nothing.

When more than one source speaks to the same relationship, the higher-precedence one wins (**code slots > agent**).

### The composition agent

The composition agent emits one structured edge per relationship. The CLI validates component names and merges those edges with deterministic sources by provenance and precedence.

- `--no-cache` — ignore caches and re-resolve composition from scratch, forcing the agent to run.
- `--agent <name>` — which coding agent runs composition, and the rest of the wizard's agent stages (`claude`, `codex`, `opencode`, `cursor`, `copilot`).
- `--prompt composition=<file-or-text>` — override the composition stage's prompt.

Because the agent path spawns a coding agent, it adds latency and cost and is best-effort.

### Slot cycles

If the resolved graph contains a circular slot dependency (A slots B, B slots A), it is detected before push. `apply` and the wizard's push path **refuse to send a manifest with cycles**; the cycle path is reported so you can break it.

---

## Prerequisites

### Coding agent

The import wizard's generation steps require a coding agent CLI in your `$PATH`. Choose one:

| Agent                          | Install                                    | Auth                                                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude Code** (`claude`)     | `npm install -g @anthropic-ai/claude-code` | `claude login` (browser OAuth) **or** set `ANTHROPIC_API_KEY`                                                                                                                                              |
| **OpenAI Codex** (`codex`)     | `npm install -g @openai/codex`             | Set `OPENAI_API_KEY`                                                                                                                                                                                       |
| **OpenCode** (`opencode`)      | `npm install -g opencode-ai`               | Configure via `opencode auth` (supports multiple providers)                                                                                                                                                |
| **Cursor** (`cursor`)          | Install [Cursor](https://cursor.com)       | Sign in to Cursor; exposes `cursor-agent` binary                                                                                                                                                           |
| **GitHub Copilot** (`copilot`) | `npm install -g @github/copilot`           | Run `copilot` once to complete GitHub OAuth login. Free plan uses Auto model selection by default. Paid plans can pin a specific model via `EDS_AGENT_MODEL_COPILOT=<model-id>` (e.g. `claude-sonnet-4.6`) |

The CLI invokes the agent non-interactively in a subprocess. If the binary is not found in `$PATH`, the command exits 1 and prints manual fallback instructions.

`experiences setup` persists your chosen agent (and optional model + custom prompt paths) to `~/.contentful/experience-design-system-cli/config.json`; later commands pick them up automatically.

### Contentful credentials

`apply` and `import` (when pushing) require access to a Contentful space. Configure these environment variables or run `experiences setup`:

```bash
export CONTENTFUL_MANAGEMENT_TOKEN=<your-cma-token>   # required
export CONTENTFUL_SPACE_ID=<your-space-id>             # required
export CONTENTFUL_ENVIRONMENT_ID=master                # required
```

Or run `experiences setup` once and they get saved to `credentials.json` and pre-filled in the wizard.

In the wizard's credentials step you can press `[s] Skip` to save-only without pushing — useful when you want a checked-in combined CDF file without a live push.

---

## The `import` wizard

```bash
experiences import [flags]
```

`experiences import` is the primary entry point and launches a full-screen wizard in a supported interactive terminal.

### Wizard step machine

The order below is the normal path. The Welcome, Token input and Path validation screens now live in the new CLI, so the wizard always starts at `credentials`.

```
credentials            — space ID, environment, CMA token and API host, prefilled from
                         `experiences setup`; press [s] to skip and save files only
  ↓
extracting             — composite relationships enabled; the selection agent runs here
                         once components are extracted
  ↓
scope-gate             — single human review gate: confirm the AI selection, toggle components
  ↓
generating             — component generation, then token mapping when a token file was given
  ↓
final-review           — edit names, $description, $default, $allowedComponents per slot,
                         $values, with source and rationale panels
  ↓
path-prompt            — where to save `components.json` (and `tokens.json`)
  ↓
previewing → preview-gate — diff against live Contentful; confirm to push
  ↓
pushing → done         — the push emits a Contentful webapp view URL for the imported components
```

There is a single human review gate (`scope-gate`) before generation. Choosing to skip credentials still saves the files; it bypasses the preview and refuses to push.

### Save and push

After final-review the wizard always saves one combined `components.json` CDF (components and design tokens) and then, unless credentials were skipped, previews the diff and pushes it to Contentful. The wizard records each saved run in `~/.contentful/experience-design-system-cli/state/runs.json`.

### Custom skill prompts

Custom `.md` skill prompt paths can be saved via `experiences setup`; the CLI emits a banner at agent invocation when an override is active.

### Flag reference — `experiences import`

| Flag                     | Default                   | Description                                                                                                                                                         |
| ------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--project <path>`       | `.`                       | Project root to analyze                                                                                                                                             |
| `--tokens <path>`        | —                         | Raw token source file (SCSS, CSS variables, JS/TS, Style Dictionary, …) to classify and import alongside components; skips the interactive token prompt             |
| `--agent <name>`         | saved by setup / `claude` | Coding agent, with an optional model as `agent:model` or `"agent model"`                                                                                            |
| `--prompt <stage=value>` | —                         | Override a stage prompt (repeatable); value is a file path or literal text, e.g. `--prompt select=./p.md`. Stages used today: `composition`, `select`, `map-tokens` |
| `--no-cache`             | cache on                  | Re-run all steps instead of reusing cached results                                                                                                                  |

`--model`, `--composition-map`, `--skip-map-tokens` and `--raw-tokens` were removed from `import`. Unknown flags are rejected. Pass the model through `--agent` instead, and use `--tokens` for a token file.

### Choosing the agent and model

`--agent` accepts `claude`, `codex`, `opencode`, `cursor` or `copilot`, optionally followed by a model: `--agent claude:sonnet` or `--agent "claude sonnet"`. The agent resolves in this order:

1. `--agent <name>` flag
2. `agent` field saved in `~/.contentful/experience-design-system-cli/config.json` by `experiences setup`
3. Built-in default, `claude`

The model resolves the same way: the model part of `--agent`, then the `agentModel` field in `credentials.json`, then the agent's own lightweight default. You can also set a model per agent with `EDS_AGENT_MODEL_<AGENT>` (for example `EDS_AGENT_MODEL_CLAUDE`).

---

### `apply`

This command is the non-wizard route to the same diff and push logic. It accepts one CDF file containing all component and design token definitions.

`apply` emits a Contentful webapp view URL for the imported components in its JSON summary (`viewUrl`) so callers can deep-link into the management UI after a successful push.

Design tokens are read from the same CDF file, so there is no separate token flag.

```bash
experiences apply <file>
```

`apply` is interactive and loads credentials from `experiences setup` or environment variables. Remote ComponentTypes and DesignTokens missing from the pushed manifest are always skipped.

Design tokens are written first (component types may reference token kinds). Each entity write is recorded in the session database atomically — interrupted pushes resume from where they left off.

---

## Session Database

All pipeline state is stored in `~/.contentful/experience-design-system-cli/pipeline.db` (SQLite). The path can be overridden with the `EDS_PIPELINE_DB_PATH` environment variable. The push-resumption database is at `~/.contentful/experience-design-system-cli/import.db` (override with `EDS_IMPORT_DB_PATH`).

---

## Terminal Compatibility

- The scope-gate step shows two columns at 100 or more terminal columns and one column below that; a wider terminal is more comfortable for the final-review editor
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

- Persistently: run `experiences setup`, open **Usage analytics** and choose "Don't share usage data". This writes `analyticsDisabled: true` to `~/.contentful/experience-design-system-cli/config.json`, which persists across invocations until you change it again — it will not silently re-enable itself.
- Per invocation:

  ```bash
  DISABLE_ANALYTICS=1 experiences import
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

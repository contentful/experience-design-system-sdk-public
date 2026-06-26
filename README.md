# Experience Design System SDK

Contentful Experiences lets you compose pages and layouts from your own design system components. The `@contentful/experience-design-system-cli` imports your design system into Contentful. It extracts Component Type definitions from your local codebase, invokes an AI agent to generate Component Definition Format (CDF) definitions, and pushes them to your Contentful space.

Your codebase remains the single source of truth. The CLI analyzes your source files (`.tsx`, `.ts`, `.jsx`, `.js`, `.vue`, `.astro`) using static analysis, then delegates property classification and CDF generation to a coding agent.

## Prerequisites

- **Node.js 24**
- **pnpm 10.27.0+**
- **A coding agent** in `$PATH` — Claude Code, Codex, OpenCode, or Cursor
- **A Contentful CMA token** — set `CONTENTFUL_MANAGEMENT_TOKEN`

## Quick Start

### Install

```bash
git clone https://github.com/contentful/experience-design-system-sdk-public.git
cd experience-design-system-sdk-public
pnpm install
pnpm build
```

### Link the CLI globally

```bash
cd packages/experience-design-system-cli
pnpm link --global
```

The package publishes three binaries — `experiences`, `exo`, and `experience-design-system-cli`. The docs below use `experiences` since that is the wizard-oriented entry point.

### Setup

```bash
experiences setup
```

The interactive setup wizard installs Node 24 (if needed), verifies pnpm, checks for a coding agent, and persists credentials + agent preferences to `~/.config/experiences/credentials.json`. Later commands read those values automatically.

### Run

The primary entry point is the import wizard:

```bash
experiences import
```

In an interactive terminal this launches a full-screen TUI that walks you through extraction, AI selection, manual scope review, generation, final review, and push. Credentials and project path are pre-filled from `experiences setup`. Component generation runs in parallel with credentials entry so the wizard does not block on the agent.

For scripted or CI use, pass `--auto-accept-scope` plus credentials:

```bash
experiences import \
  --project /path/to/your/component-library \
  --space-id $CONTENTFUL_SPACE_ID \
  --environment-id master \
  --cma-token $CONTENTFUL_MANAGEMENT_TOKEN \
  --auto-accept-scope \
  --yes
```

## How it works

The CLI runs your component library through four stages:

**1. Analyze** — Reads your source files and extracts every component: its name, props, types, and source location.

**2. Select** — An AI agent reviews the extracted components and decides which ones make sense to expose in Contentful Experiences (buttons, cards, layouts) and which to skip (hooks, context providers, utilities). The wizard then opens a single **scope-gate** for you to confirm or override that list. The AI auto-filter can be turned off with `--no-auto-filter`.

**3. Generate** — An AI agent takes the selected components and produces structured definitions that tell Contentful what each prop is for — whether it holds content, a design token, or interactive state. The wizard then opens a **final-review** field editor where you can edit names, descriptions, defaults, allowed values, and slot constraints inline.

**4. Apply** — Shows a diff of what will change in your Contentful space, then pushes (and by default also saves `components.json` / `tokens.json` to disk for source control).

The wizard saves a run record after each session. Use `experiences runs` to list prior sessions (or `experiences runs <id-or-path>` for a single-run detail view), `experiences import --modify <id-or-path>` to re-open the wizard pre-populated, or `experiences import --push-from-run <id-or-path>` to re-push without re-opening the wizard.

When prior runs exist and the wizard is launched without `--push-from-run`, `--modify`, or `--project`, the TUI opens with an interactive **run picker** so the operator can pick "push", "modify", or "start a new run" up front. Pass `--project` to skip the picker and go straight into a fresh extraction.

For headless operation alongside an existing checked-in `components.json`, pass `--on-conflict <overwrite|skip|fail>` to bypass the interactive save-conflict gate. Use `--print-prompt` to inspect the generate prompt without invoking the agent (replaces the deprecated `--dry-run`).

## Packages

| Package                                                                                  | Description                                                                                     |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`@contentful/experience-design-system-cli`](packages/experience-design-system-cli/)     | The CLI + interactive wizard — analyze, review, generate, validate, and push component definitions |
| [`@contentful/experience-design-system-types`](packages/experience-design-system-types/) | Shared types and schemas for the CDF and DTCG data formats                                      |

## Command Reference

Full documentation for every flag and every subcommand lives in [`packages/experience-design-system-cli/README.md`](packages/experience-design-system-cli/README.md).

| Command                            | What it does                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `experiences setup`                | Interactive setup — installs prerequisites and saves credentials + agent           |
| `experiences doctor`               | Health check — verify Node version, credentials, and agent binaries                |
| `experiences import`               | Run the full wizard or a headless pipeline (extract → select → generate → push)    |
| `experiences runs`                 | List prior wizard runs, or pass `<id-or-path>` for a single-run detail view (supports `--json`, `--pushed`, `--not-pushed`) |
| `experiences analyze extract`      | Scan source files and extract raw component definitions                            |
| `experiences analyze select`       | Interactively pick which components to include (standalone JsonEditor TUI)         |
| `experiences analyze select-agent` | AI agent picks which components belong in Experiences; pass `--show-rationale [--json]` for read-only rationale output |
| `experiences generate components`  | AI agent generates CDF definitions from raw analysis                               |
| `experiences generate tokens`      | AI agent generates DTCG design tokens from raw token data                          |
| `experiences apply preview`        | Read-only diff — what would change in Contentful                                   |
| `experiences apply select`         | Checkbox TUI to pick a subset of entities to push                                  |
| `experiences apply push`           | Write component types and design tokens to Contentful; emits webapp view URL       |
| `experiences print components`     | Export generated components to `components.json`                                   |
| `experiences print tokens`         | Export generated tokens to `tokens.json`                                           |
| `experiences print validate`       | Validate CDF or DTCG files against their schemas                                   |
| `experiences session list`         | List pipeline sessions (lower-level than `runs`)                                   |

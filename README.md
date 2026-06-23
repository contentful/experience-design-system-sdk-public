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
pnpm -F @contentful/experience-design-system-cli build
```

The final step builds the CLI package and symlinks the `experiences`, `exo`, and `experience-design-system-cli` commands alongside your `node` binary so they're available on your `$PATH`.

### Setup

```bash
experiences setup
```

### Run

```bash
experiences import
```

Or with explicit flags:

```bash
experiences import \
  --project /path/to/your/component-library \
  --space-id $CONTENTFUL_SPACE_ID \
  --environment-id master \
  --agent claude
```

## How it works

The CLI runs your component library through four stages:

**1. Analyze** — Reads your source files and extracts every component: its name, props, and types.

**2. Select** — An AI agent reviews the extracted components and decides which ones make sense to expose in Contentful Experiences (buttons, cards, layouts) and which to skip (hooks, context providers, utilities). You can also review and adjust this list yourself using the interactive TUI.

**3. Generate** — An AI agent takes the selected components and produces structured definitions that tell Contentful what each prop is for — whether it holds content, a design token, or interactive state.

**4. Apply** — Shows you a preview of what will change in your Contentful space, then pushes the component definitions when you're ready.

Each stage saves its output locally, so you can re-run or resume any step without starting over.

## Packages

| Package                                                                                  | Description                                                                                     |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`@contentful/experience-design-system-cli`](packages/experience-design-system-cli/)     | The CLI + interactive TUI — analyze, review, generate, validate, and push component definitions |
| [`@contentful/experience-design-system-types`](packages/experience-design-system-types/) | Shared types and schemas for the CDF and DTCG data formats                                      |

## Command Reference

Full documentation for every flag, every subcommand is in [`packages/experience-design-system-cli/README.md`](packages/experience-design-system-cli/README.md).

| Command                            | What it does                                                        |
| ---------------------------------- | ------------------------------------------------------------------- |
| `experiences setup`                | Interactive setup — configure credentials and agent                 |
| `experiences analyze extract`      | Scan source files and extract raw component definitions             |
| `experiences analyze select`       | Interactively pick which components to include (TUI)                |
| `experiences analyze select-agent` | AI agent picks which components belong in Experiences               |
| `experiences generate components`  | AI agent generates CDF definitions from raw analysis                |
| `experiences generate tokens`      | AI agent generates DTCG design tokens from raw token data           |
| `experiences apply preview`        | Read-only diff — what would change in Contentful                    |
| `experiences apply select`         | Checkbox TUI to pick a subset of entities to push                   |
| `experiences apply push`           | Write component types and design tokens to Contentful               |
| `experiences import`               | Run the full pipeline in one command                                |
| `experiences print components`     | Export generated components to `components.json`                    |
| `experiences print tokens`         | Export generated tokens to `tokens.json`                            |
| `experiences print validate`       | Validate CDF or DTCG files against their schemas                    |
| `experiences doctor`               | Health check — verify Node version, credentials, and agent binaries |

# Experience Design System SDK

Contentful Experiences lets you compose pages and layouts from your own design system components. The `@contentful/experience-design-system-cli` imports your design system into Contentful. It extracts Component Type definitions from your local codebase, invokes an AI agent to generate Component Definition Format (CDF) definitions, and pushes them to your Contentful space.

Your codebase remains the single source of truth. The CLI analyzes your source files (`.tsx`, `.ts`, `.jsx`, `.js`, `.vue`, `.astro`) using static analysis, then delegates property classification and CDF generation to a coding agent.

## Quick Start

### Prerequisites

- **Node.js 24** — run `nvm use` (`.nvmrc` is included)
- **pnpm 10.27.0+** — `corepack enable && corepack prepare`
- **A coding agent** in `$PATH` for `generate` commands — Claude Code, OpenAI Codex, OpenCode, or Cursor (see [agent setup](packages/experience-design-system-cli/README.md#coding-agent))
- **A Contentful CMA token** for `apply` commands — set `CONTENTFUL_MANAGEMENT_TOKEN` (see [credentials](packages/experience-design-system-cli/README.md#contentful-credentials))

### Install

```bash
git clone https://github.com/contentful/experience-design-system-sdk-public.git
cd experience-design-system-sdk-public
pnpm install
pnpm build
```

### Run the full pipeline

```bash
experiences import \
  --project /path/to/your/component-library \
  --space-id $CONTENTFUL_SPACE_ID \
  --environment-id master \
  --agent claude
```

## How it works

The pipeline has four stages:

```
1. analyze        →   2. select         →   3. generate        →   4. apply
   scan source         AI picks which        AI generates           push to
   extract props       components go         CDF definitions        Contentful
   into session DB     into Experiences     back into session DB   via Sources API
```

**1. analyze** — Scans your source files (`.tsx`, `.ts`, `.jsx`, `.vue`, `.astro`) using the TypeScript compiler. Extracts component names, props, slots, and prop types. Stores everything in a local SQLite session database.

**2. select** — An AI agent reviews every extracted component and decides which ones belong in Experience Orchestration (visible UI: atoms, molecules, organisms) vs. which ones to skip (hooks, context providers, analytics wrappers, routing utilities). You can also do this step manually with the interactive TUI.

**3. generate** — An AI agent takes the accepted components and generates CDF (Component Definition Format) definitions: structured JSON that maps each prop to an component property type (content, design, or state) and optionally links it to your design token library.

**4. apply** — Diffs your generated definitions against what already exists in Contentful, shows you what will change, and writes component types and design tokens to Experiences via the Sources API.

All intermediate data lives in a local SQLite session database — no JSON files are written between steps. Each command reads its inputs from the session and writes its outputs back. Any step can be re-run in isolation or resumed after a failure.

## Packages

| Package                                                                                  | Description                                                                                     |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`@contentful/experience-design-system-cli`](packages/experience-design-system-cli/)     | The CLI + interactive TUI — analyze, review, generate, validate, and push component definitions |
| [`@contentful/experience-design-system-types`](packages/experience-design-system-types/) | Shared TypeScript types and Zod schemas for the CDF and DTCG data formats                       |

## Command Reference

Full documentation — every flag, every subcommand — is in [`packages/experience-design-system-cli/README.md`](packages/experience-design-system-cli/README.md).

| Command                            | What it does                                                        |
| ---------------------------------- | ------------------------------------------------------------------- |
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
| `experiences session list`         | List pipeline sessions                                              |
| `experiences session show <id>`    | Show all steps for a session                                        |
| `experiences session stats`        | Show aggregate storage and record counts                            |
| `experiences session prune`        | Delete old sessions                                                 |
| `experiences doctor`               | Health check — verify Node version, credentials, and agent binaries |

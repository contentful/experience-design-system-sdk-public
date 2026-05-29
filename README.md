# Experience Design System SDK

CLI for ingesting a design system component library into [Contentful Experience Orchestration (ExO)](https://www.contentful.com/help/experience-orchestration/).

## What is this?

Contentful Experience Orchestration lets you compose pages and layouts from your own design system components. For that to work, Contentful needs to know what components exist, what props they accept, and how those props map to ExO concepts like content fields, design tokens, and interactive state.

Describing all of that by hand is slow and error-prone. This CLI automates the whole thing.

Point it at your component library. It reads your TypeScript/JSX/Vue/Astro source files, uses an AI coding agent to figure out which components belong in ExO and generate their structured definitions, and pushes everything to Contentful. You go from "has a design system" to "components available in Experience Orchestration" in one command.

## How it works

The pipeline has four stages:

```
1. analyze        →   2. select         →   3. generate        →   4. apply
   scan source         AI picks which        AI generates           push to
   extract props       components go         CDF definitions        Contentful
   into session DB     into ExO              back into session DB   via Sources API
```

**1. analyze** — Scans your source files (`.tsx`, `.ts`, `.jsx`, `.vue`, `.astro`) using the TypeScript compiler. Extracts component names, props, slots, and prop types. Stores everything in a local SQLite session database.

**2. select** — An AI agent reviews every extracted component and decides which ones belong in Experience Orchestration (visible UI: atoms, molecules, organisms) vs. which ones to skip (hooks, context providers, analytics wrappers, routing utilities). You can also do this step manually with the interactive TUI.

**3. generate** — An AI agent takes the accepted components and generates [CDF (Component Definition Format)](ARCHITECTURE.md#cdf-component-definition-format) definitions: structured JSON that maps each prop to an ExO property type (content, design, or state) and optionally links it to your design token library.

**4. apply** — Diffs your generated definitions against what already exists in Contentful, shows you what will change, and writes component types and design tokens to ExO via the Sources API.

All intermediate data lives in a local SQLite session database — no JSON files are written between steps. Each command reads its inputs from the session and writes its outputs back. Any step can be re-run in isolation or resumed after a failure.

## Packages

| Package | Description |
|---|---|
| [`@contentful/experience-design-system-cli`](packages/experience-design-system-cli/) | The CLI + interactive TUI — analyze, review, generate, validate, and push component definitions |
| [`@contentful/experience-design-system-types`](packages/experience-design-system-types/) | Shared TypeScript types and Zod schemas for the CDF and DTCG data formats |

## Quick Start

### Prerequisites

- **Node.js 24** — run `nvm use` (`.nvmrc` is included)
- **pnpm 10.27.0+** — `corepack enable && corepack prepare`
- **GitHub Packages token** — a personal access token with `read:packages` scope for `@contentful`-scoped packages
- **A coding agent** in `$PATH` for `generate` commands — Claude Code, OpenAI Codex, OpenCode, or Cursor (see [agent setup](packages/experience-design-system-cli/README.md#coding-agent))
- **A Contentful CMA token** for `apply` commands — set `CONTENTFUL_MANAGEMENT_TOKEN` (see [credentials](packages/experience-design-system-cli/README.md#contentful-credentials))

```bash
# Configure GitHub Packages registry
pnpm config set @contentful:registry https://npm.pkg.github.com
pnpm config set -- //npm.pkg.github.com/:_authToken <your-github-token>

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Verify the CLI is available
node packages/experience-design-system-cli/bin/cli.js --help
```

### Run the full pipeline in one command

```bash
experiences import \
  --project /path/to/your/component-library \
  --space-id $CONTENTFUL_SPACE_ID \
  --environment-id master \
  --agent claude
```

### Or run each step individually

```bash
# 1. Extract components from source (prints session=<id> to stdout)
experiences analyze extract --project /path/to/your/lib

# 2. AI agent picks which components belong in ExO
experiences analyze select-agent --agent claude

# 3. AI agent generates CDF component definitions
experiences generate components --agent claude

# 4. Preview what will change in Contentful (read-only, no writes)
experiences apply preview \
  --session $SESSION_ID \
  --space-id $CONTENTFUL_SPACE_ID \
  --environment-id master

# 5. Push component types and design tokens to Contentful
experiences apply push \
  --session $SESSION_ID \
  --space-id $CONTENTFUL_SPACE_ID \
  --environment-id master \
  --yes
```

## Command Reference

Full documentation — every flag, every subcommand — is in [`packages/experience-design-system-cli/README.md`](packages/experience-design-system-cli/README.md).

| Command | What it does |
|---|---|
| `experiences analyze extract` | Scan source files and extract raw component definitions |
| `experiences analyze select` | Interactively pick which components to include (TUI) |
| `experiences analyze select-agent` | AI agent picks which components belong in ExO |
| `experiences generate components` | AI agent generates CDF definitions from raw analysis |
| `experiences generate tokens` | AI agent generates DTCG design tokens from raw token data |
| `experiences apply preview` | Read-only diff — what would change in Contentful |
| `experiences apply select` | Checkbox TUI to pick a subset of entities to push |
| `experiences apply push` | Write component types and design tokens to Contentful |
| `experiences import` | Run the full pipeline in one command |
| `experiences print components` | Export generated components to `components.json` |
| `experiences print tokens` | Export generated tokens to `tokens.json` |
| `experiences print validate` | Validate CDF or DTCG files against their schemas |
| `experiences session list` | List pipeline sessions |
| `experiences session show <id>` | Show all steps for a session |
| `experiences session stats` | Show aggregate storage and record counts |
| `experiences session prune` | Delete old sessions |
| `experiences doctor` | Health check — verify Node version, credentials, and agent binaries |

## Development

```bash
# Build all packages
pnpm build

# Run all tests
pnpm test

# Lint all packages
pnpm lint

# Affected-only variants (faster for local iteration)
pnpm affected:build
pnpm affected:test
pnpm affected:lint

# Single package
pnpm -F @contentful/experience-design-system-cli build
pnpm -F @contentful/experience-design-system-cli test
```

Run the CLI directly from source:

```bash
node packages/experience-design-system-cli/bin/cli.js --help
```

## Releases

Releases are automated on merge to `main` via Nx Release + GitHub Packages. Commit type determines version bump: `fix` → patch, `feat` → minor, `feat!` → major. Dev prereleases are published from PRs automatically.

All commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/).

# Experience Design System SDK

Tools for extracting, validating, reviewing, and importing design system component definitions into Contentful Experience Orchestration (ExO).

## What's in this repo

| Package | Version | Description |
|---|---|---|
| [`@contentful/experience-design-system-cli`](packages/experience-design-system-cli/) | see package.json | CLI + TUI for analyzing, generating, validating, reviewing, and importing component definitions |
| [`@contentful/experience-design-system-types`](packages/experience-design-system-types/) | see package.json | Shared TypeScript types and schemas for CDF and DTCG formats |

## Quick Start

### Prerequisites

- Node.js 24 (see `.nvmrc` — use `nvm use` to switch automatically)
- pnpm 10.27.0+ (`corepack enable && corepack prepare`)
- A coding agent CLI in `$PATH` for `generate` commands (Claude Code, OpenAI Codex, OpenCode, or Cursor — see [agent setup](packages/experience-design-system-cli/README.md#prerequisites))
- A Contentful CMA token for `apply` commands — set `CONTENTFUL_MANAGEMENT_TOKEN` (see [Contentful credentials](packages/experience-design-system-cli/README.md#prerequisites))

```bash
# Install dependencies
pnpm install

# Build all packages (also links experiences / exo to your PATH via postbuild)
pnpm build

# Verify the CLI is available
experiences --help
```

### Using the CLI

Run each step individually, or use `import` to orchestrate the whole pipeline at once.

All intermediate data flows through a local SQLite session database — no JSON files are written between steps. Each command reads its inputs from the session and writes its outputs back to it. Use [`print`](#print-commands) to export session data to JSON on demand.

**Step-by-step:**

```bash
# 1. Extract component definitions from a project (stores results in session DB, prints session=<id>)
experiences analyze extract --project /path/to/your/lib

# 2. AI agent picks which components belong in Experience Orchestration
experiences analyze select-agent --agent claude

# 3. Invoke a coding agent to generate CDF component definitions (stored in session DB)
experiences generate components --agent claude

# 4. Preview what will be created/updated in Contentful (reads from session DB, no writes)
experiences apply preview \
  --session <id> \
  --space-id $CONTENTFUL_SPACE_ID \
  --environment-id master

# 5. (Optional) Interactively select a subset of entities to push
experiences apply select \
  --session <id> \
  --space-id $CONTENTFUL_SPACE_ID \
  --environment-id master

# 6. Push entities to Contentful ExO (reads from session DB)
experiences apply push \
  --session <id> \
  --space-id $CONTENTFUL_SPACE_ID \
  --environment-id master
```

**Or run the full pipeline in one command:**

```bash
experiences import \
  --project /path/to/your/lib \
  --space-id $CONTENTFUL_SPACE_ID \
  --environment-id master \
  --agent claude
```

See [`packages/experience-design-system-cli/README.md`](packages/experience-design-system-cli/README.md) for full command documentation.

## Documentation

| Document | What it covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System overview, package structure, data formats, extractor internals, CI/CD |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Dev setup, workflow, testing, commit convention, release process |
| [AGENTS.md](AGENTS.md) | What AI coding agents need to know — sharp edges, invariants, gotchas |

## Development

```bash
# Build all packages
pnpm build

# Run all tests
pnpm test

# Lint all packages
pnpm lint

# Affected-only (faster for local iteration)
pnpm affected:build
pnpm affected:test
pnpm affected:lint

# Single package
pnpm -F @contentful/experience-design-system-cli build
pnpm -F @contentful/experience-design-system-cli test
```

Run the CLI directly from source without relying on PATH symlinks:

```bash
node packages/experience-design-system-cli/bin/cli.js --help
```

## Releases

Releases are published to [npmjs.com](https://www.npmjs.com/package/@contentful/experience-design-system-cli). Commit type determines version bump: `fix` → patch, `feat` → minor, `feat!` → major.

All commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/).

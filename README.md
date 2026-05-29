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
- GitHub personal access token with `read:packages` scope (for `@contentful`-scoped packages)
- A coding agent CLI in `$PATH` for `generate` commands (Claude Code, OpenAI Codex, OpenCode, or Cursor — see [agent setup](packages/experience-design-system-cli/README.md#prerequisites))
- A Contentful CMA token for `apply` commands — set `CONTENTFUL_MANAGEMENT_TOKEN` (see [Contentful credentials](packages/experience-design-system-cli/README.md#prerequisites))

```bash
# Configure GitHub Packages registry
pnpm config set @contentful:registry https://npm.pkg.github.com
pnpm config set -- //npm.pkg.github.com/:_authToken <your-token>

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Using the CLI

Run each step individually, or use `import` to orchestrate the whole pipeline at once.

All intermediate data flows through a local SQLite session database — no JSON files are written between steps. Each command reads its inputs from the session and writes its outputs back to it. Use [`print`](#print-commands) to export session data to JSON on demand.

**Step-by-step:**

```bash
# 1. Extract component definitions from a project (stores results in session DB, prints session=<id>)
experience-design-system-cli analyze extract --project /path/to/your/lib

# 2. Interactively review and select components for generation
experience-design-system-cli analyze select

# 3. Invoke a coding agent to generate CDF component definitions (stored in session DB)
experience-design-system-cli generate components --agent claude

# 4. Preview what will be created/updated in Contentful (reads from session DB, no writes)
experience-design-system-cli apply preview \
  --session <id> \
  --space-id $CONTENTFUL_SPACE_ID \
  --environment-id master

# 5. (Optional) Interactively select a subset of entities to push
experience-design-system-cli apply select \
  --session <id> \
  --space-id $CONTENTFUL_SPACE_ID \
  --environment-id master

# 6. Push entities to Contentful ExO (reads from session DB)
experience-design-system-cli apply push \
  --session <id> \
  --space-id $CONTENTFUL_SPACE_ID \
  --environment-id master
```

**Or run the full pipeline in one command:**

```bash
experience-design-system-cli import \
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
| [docs/adr/](docs/adr/) | Architecture Decision Records — why significant decisions were made |
| [docs/specs/](docs/specs/) | Feature specifications |

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

## Releases

Releases are automated on merge to `main` via Nx Release + GitHub Packages. Commit type determines version bump: `fix` → patch, `feat` → minor, `feat!` → major. Dev prereleases are published from PRs automatically.

All commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/).

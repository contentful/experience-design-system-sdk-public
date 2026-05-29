# Contributing

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24 (see `.nvmrc`) | Use `nvm use` to switch automatically |
| pnpm | 10.27.0+ | Run `corepack enable` then `corepack prepare` |

The repo uses GitHub Packages as its npm registry for `@contentful`-scoped packages. You need a GitHub personal access token with `read:packages` scope:

```bash
pnpm config set @contentful:registry https://npm.pkg.github.com
pnpm config set -- //npm.pkg.github.com/:_authToken <your-token>
```

## Getting Started

```bash
# Clone and install
git clone <repo-url>
cd experience-design-system-sdk
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test

# Typecheck all packages
pnpm typecheck
```

## Repository Structure

```
packages/
  experience-design-system-cli/    # CLI + TUI
  experience-design-system-types/  # Shared types and schemas
.github/workflows/                 # CI/CD pipelines
scripts/                           # Release automation
```

## Development Workflow

### Working on a package

```bash
# Build a single package (watches for changes)
pnpm -F @contentful/experience-design-system-cli build

# Run tests for a single package
pnpm -F @contentful/experience-design-system-cli test

# Run tests in watch mode
pnpm -F @contentful/experience-design-system-cli test:watch

# Typecheck
pnpm -F @contentful/experience-design-system-cli typecheck

# Lint
pnpm -F @contentful/experience-design-system-cli lint
pnpm -F @contentful/experience-design-system-cli lint:fix
```

### Running the CLI locally

After building, the CLI is available at:

```bash
node packages/experience-design-system-cli/bin/cli.js --help
```

Or install it globally from the local build:

```bash
npm install -g packages/experience-design-system-cli
experience-design-system-cli --help
```

### Testing the analyze command against a real codebase

```bash
experience-design-system-cli analyze extract \
  --project /path/to/your/component-library \
  --dir src
```

Extracted components are stored in the session database. Run `analyze edit` to review and accept proposals, or pass `--accept-all` when calling `import` for a fully non-interactive run.

## Commit Convention

This repo enforces [Conventional Commits](https://www.conventionalcommits.org/) via `commitlint`. Every commit message must follow:

```
type(scope): description
```

Valid types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, `build`, `revert`

Examples:
```
feat(cli): add --format flag to analyze command
fix(analyze): handle SVGProps without inflating prop count
chore: update pnpm lockfile
docs: add ARCHITECTURE.md
```

A pre-commit hook runs `commitlint` and `lint-staged` on every commit. The hook also runs `pnpm lint:staged` to catch lint errors before they reach CI.

## Tests

Tests live in `packages/<name>/test/` and mirror the `src/` structure. The test runner is [Vitest](https://vitest.dev/).

```bash
# Run all tests
pnpm test

# Run affected tests only (fast path for PRs)
pnpm affected:test

# Run with coverage
pnpm -F @contentful/experience-design-system-cli test -- --coverage
```

TUI tests use [`ink-testing-library`](https://github.com/vadimdemedes/ink-testing-library). Set `NO_COLOR=1` in the environment before running tests to suppress ANSI codes in snapshot output. Tests that assert on raw strings should strip ANSI codes before comparing.

CLI integration tests require a compiled `dist/` directory. The test setup script compiles if `dist/` is missing.

## Snapshot Tests

When you change TUI output intentionally, update snapshots:

```bash
pnpm -F @contentful/experience-design-system-cli test -- --update-snapshots
```

Commit the updated snapshot files alongside the code change.

## Adding a New Package

1. Create `packages/<package-name>/`
2. Add `package.json` with `name: "@contentful/<package-name>"`, `"type": "module"`, and `exports`
3. Add `tsconfig.json` (extends `@tsconfig/node24`), `tsconfig.build.json`, and `project.json` for Nx targets
4. Add `eslint.config.ts`
5. Source goes under `src/`, tests under `test/`

## Adding a New Framework Extractor

1. Create `src/analyze/extract/<framework>.ts` implementing the `ComponentExtractor` interface from `src/types.ts`
2. Register it in `src/analyze/extract/pipeline.ts` — add to the `extractors` array and provide a `fileFilter`
3. Write tests in `test/analyze/extract/<framework>.test.ts`

## Branching and Deployment

- `main` — production; release on every push
- Feature branches — `feat/<name>`, stacked on main; dev build published on push
- `chore/<name>` — maintenance; dev build published, no production release unless merged to main

## Pull Requests

- PR titles must follow Conventional Commits (validated in CI)
- All tests must pass
- Bito Code Review will automatically review your PR — address or reply to all comments before merging
- Squash merge to main is preferred for feature work; merge commits are acceptable for longer-lived branches

## CI/CD

All CI runs via GitHub Actions (`.github/workflows/ci.yml`):

| Job | Trigger | What it does |
|---|---|---|
| `lint` | PR, merge group, push to main | ESLint + Prettier via `pnpm affected:lint` |
| `test` | PR, merge group, push to main | Vitest + TypeScript compile via `pnpm affected:test` |
| `release` | Push to main (non-bot) | `pnpm release-packages` → semantic release to GitHub Packages |
| `release-dev` | PR, non-main push | `pnpm release-development-packages` → prerelease version |

Nx affected detection uses `nrwl/nx-set-shas` to compare `NX_BASE..NX_HEAD`. Only packages with changed files run lint/test/build.

Releases follow [Conventional Commits](https://www.conventionalcommits.org/): `fix` → patch, `feat` → minor, `feat!` or `BREAKING CHANGE` → major.

## Release Process

Releases are fully automated. On every merge to `main`:

1. CI runs lint + test
2. If passing, `pnpm release-packages` runs Nx Release, which reads conventional commit history to determine the version bump, tags the release, and publishes to GitHub Packages

**You do not manually bump versions or create tags.** The commit type determines the version:

| Commit type | Version bump |
|---|---|
| `fix` | patch (0.0.x) |
| `feat` | minor (0.x.0) |
| `feat!` or `BREAKING CHANGE` footer | major (x.0.0) |

Dev prereleases are published automatically from PRs and non-main branches with a `0.0.0-dev-build-<sha>` identifier.

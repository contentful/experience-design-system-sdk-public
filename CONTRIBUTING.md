# Contributing

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24 (see `.nvmrc`) | Use `nvm use` to switch automatically |
| pnpm | 10.27.0+ | Run `corepack enable` then `corepack prepare` |

## Getting Started

```bash
# Clone and install
git clone <repo-url>
cd experience-design-system-sdk-public
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
  experience-design-system-cli/         # CLI + TUI
  experience-design-system-extraction/  # Component extraction engine (ts-morph, per-framework parsers)
  experience-design-system-generation/  # Agent-invocation and skill-prompt engine (used by `generate`)
  experience-design-system-client/      # Generated API client (from openapi.json), used by `apply`
  experience-design-system-types/       # Shared types and schemas
.github/workflows/                      # CI/CD pipelines
scripts/                                # Release automation
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

Extracted components are stored in the session database. Run `analyze select` (alias `analyze edit`) to review and accept proposals via the standalone JsonEditor TUI, or pass `--auto-accept-scope --yes` along with credentials when calling `experiences import` for a fully non-interactive run.

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

The CLI package's `vitest.config.ts` runs with `pool: 'forks'` and `retry: 1` for worker isolation. Contributors do not need to configure this, but expect test wall-clock time to reflect per-test process forks rather than a shared worker pool — flaky individual tests retry once before failing the suite.

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

- `main` — production. Every push runs a stable, conventional-commit-driven release: version bump, git tag, publish to GitHub Packages, then mirror the new version to the public npmjs.org registry.
- `canary` — pre-release integration branch. Every push publishes a real, tagged `X.Y.Z-alpha.N` prerelease (npm dist-tag `canary`) to GitHub Packages. The release step syncs `main` into `canary` before releasing, so canary always includes everything already on main.
- Any other branch or open PR — no dedicated naming convention is enforced. Every PR (and any push to a non-main, non-canary branch that CI runs on) publishes a throwaway, SHA-stamped dev prerelease (npm dist-tag `dev`) for the Nx-affected packages only, with no git commit/tag/push. If no packages are affected, the release step is a no-op.

## Pull Requests

- PR titles must follow Conventional Commits (validated in CI)
- All tests must pass
- Bito Code Review will automatically review your PR — address or reply to all comments before merging
- Squash merge or rebase merge only — merge commits are disabled at the repo level
- At least one approving code owner review is required before merging

## CI/CD

All CI runs via GitHub Actions (`.github/workflows/ci.yml`):

| Job | Trigger | What it does |
|---|---|---|
| `lint` | push to main/canary, PR to main, merge group | ESLint + Prettier via `pnpm affected:lint` |
| `test` | push to main/canary, PR to main, merge group | Vitest + TypeScript compile via `pnpm affected:test` |
| `test-summary` | always, after `lint`/`test` | Fails the check if either upstream job failed — a single required status for branch protection |
| `release` | push to main (excluding automation-bot commits), push to canary (excluding dependabot and automation-bot commits), or any PR targeting main | Runs `pnpm release` (see Release Process below). Behavior branches internally on `GITHUB_REF` — this is one job, not separate prod/dev jobs |

A second workflow, `.github/workflows/release-guard.yml`, runs on PR open/sync/reopen and merge-group events. It does not itself gate anything — release concurrency is already serialized by the `release` job's `concurrency.group` in `ci.yml` — but it gives PRs a named check to point at.

Nx affected detection uses `nrwl/nx-set-shas` to compare `NX_BASE..NX_HEAD`. Only packages with changed files run lint/test/build.

Releases follow [Conventional Commits](https://www.conventionalcommits.org/): `fix` → patch, `feat` → minor, `feat!` or `BREAKING CHANGE` → major.

## Release Process

Releases are fully automated via `scripts/release.js` (invoked as `pnpm release` from the `release` job in CI). The script branches on which ref triggered it:

**`main` (stable release):**
1. Nx Release reads conventional commit history since the last tag to determine the version bump
2. Commits the version bump, tags it, and pushes to `main`
3. Publishes the new version to GitHub Packages
4. If a new tag now points at `HEAD`, a follow-up CI step mirrors the same version to the public npmjs.org registry via OIDC trusted publishing, so it's installable from `npmjs.org` and not just GitHub Packages

**`canary` (pre-release integration):**
1. Syncs `main` into `canary` first
2. Nx Release computes an `X.Y.Z-alpha.N` prerelease version from conventional commits
3. Commits, tags, and pushes the prerelease to `canary`
4. Publishes to GitHub Packages under the npm dist-tag `canary`
5. Exits without publishing if there are no releasable changes since the last canary tag

**Any other branch or PR (dev build):**
1. Determines the Nx-affected packages; exits with no publish if none changed
2. Publishes a throwaway prerelease per affected package, versioned `<version>-dev-build-<git-sha>`, to GitHub Packages under the npm dist-tag `dev`
3. No git commit, tag, or push — dev builds leave no permanent trace in the repo

**You do not manually bump versions or create tags.** On `main` and `canary`, the commit type determines the version bump:

| Commit type | Version bump |
|---|---|
| `fix` | patch (0.0.x) |
| `feat` | minor (0.x.0) |
| `feat!` or `BREAKING CHANGE` footer | major (x.0.0) |

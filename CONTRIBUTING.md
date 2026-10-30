# Contributing

## Prerequisites

| Tool    | Version                                 | Notes                                                  |
| ------- | --------------------------------------- | ------------------------------------------------------ |
| Node.js | 24.22.1 (`.nvmrc`); `engines` is `>=24` | Use `nvm use` to switch automatically                  |
| pnpm    | 10.27.0 (pinned by `packageManager`)    | Run `corepack enable`; corepack then uses that version |

## Getting Started

```bash
# Clone and install
git clone https://github.com/contentful/experience-design-system-sdk-public.git
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
  experience-design-system-cli/              # Published CLI (`experiences`): Ink TUI that drives the import flow
  experience-design-system-backend-pipeline/ # Extraction, agent invocation, selection, composition, apply and
                                             # persistence (session DB, credentials); the CLI uses it at build time
  experience-design-system-client/           # Generated API client (from openapi.json), used by backend-pipeline's apply step
  experience-design-system-types/            # Shared types, schemas and validation
.github/workflows/                           # CI/CD pipelines
scripts/                                     # Release automation, CLI linking, quality ratchets
```

`cli` depends on `backend-pipeline` and `types`; `backend-pipeline` depends on `client` and `types`. The CLI bundles
`backend-pipeline` when it builds, so it is a dev dependency of the CLI.

## Development Workflow

### Working on a package

Replace the package name to target another package (`@contentful/experience-design-system-backend-pipeline`,
`-client`, `-types`).

```bash
# Build a single package
pnpm -F @contentful/experience-design-system-cli build

# Run tests for a single package
pnpm -F @contentful/experience-design-system-cli test

# Run a single test file (vitest, from the package directory)
pnpm -F @contentful/experience-design-system-cli exec vitest run test/commands.test.ts

# Typecheck
pnpm -F @contentful/experience-design-system-cli typecheck

# Lint
pnpm -F @contentful/experience-design-system-cli lint
pnpm -F @contentful/experience-design-system-cli lint:fix
```

The client and types packages also have a `test:watch` script. The CLI and backend-pipeline packages do not; for watch
mode run `pnpm -F <package> exec vitest`.

### Running the CLI locally

After building, run the CLI from the checkout:

```bash
node packages/experience-design-system-cli/bin/cli.js --help
```

Outside CI, `pnpm build` also runs `scripts/link-cli.js` (the root `postbuild` script), which symlinks the local build
into your global npm bin directory as `experiences`, `exo` and `experience-design-system-cli`:

```bash
experiences --help
```

### Live reload while working on the TUI

From a checkout, run the TUI in watch mode instead of rebuilding by hand:

```bash
experiences import --watch          # after a first `pnpm build`, which links the command
pnpm dev                            # same thing from the repo root
```

It rebuilds `dist/` whenever the source changes and restarts the app, so you land back on the Start screen after each
save. Notes:

- It is a restart, not hot module replacement: Ink has no Fast Refresh, so screen state is lost.
- It writes `dist/index.js` and `dist/app.js` in place and never deletes `dist/` (unlike `pnpm build`).
- It watches only the CLI package's own source. Other workspace packages are imported from their built output, so
  after editing one (for example `backend-pipeline`) rebuild it with `pnpm -F <package> build`.
- Pressing `q` quits the app but leaves the watcher running; save a file to start it again. Ctrl+C stops everything.
- `--watch` only works from a checkout. The published package does not include the dev script.

### Testing the import wizard against a real codebase

```bash
node packages/experience-design-system-cli/bin/cli.js import
```

`import` needs an interactive terminal and a coding agent on your `$PATH` (`claude` by default; pick another with `--agent`). The wizard asks for the project folder and an optional token file on its own screens, so there are no flags for them. Extracted components are stored in the session database (`EDS_PIPELINE_DB_PATH` overrides its location); use a temp path to avoid touching your real one. To push, set your Contentful space ID, environment ID and management token in the Settings menu, or export `CONTENTFUL_SPACE_ID`, `CONTENTFUL_ENVIRONMENT_ID` and `CONTENTFUL_MANAGEMENT_TOKEN`.

## Commit Convention

This repo enforces [Conventional Commits](https://www.conventionalcommits.org/) via `commitlint`. Every commit message must follow:

```
type(scope): description
```

Valid types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, `build`, `revert`

Examples:

```
feat(cli): add --agent flag to import
fix(backend-pipeline): handle SVGProps without inflating prop count
chore: update pnpm lockfile
docs: add ARCHITECTURE.md
```

Git hooks (husky) check every commit: `commit-msg` runs `commitlint`, and `pre-commit` runs `pnpm lint:staged`, which runs `lint:fix`, `typecheck` and `test` for the affected projects to catch errors before they reach CI.

## Tests

The test runner is [Vitest](https://vitest.dev/). Where tests live depends on the package:

- `cli` and `types`: `packages/<name>/test/`
- `backend-pipeline`: `packages/experience-design-system-backend-pipeline/test/`, plus `test/` folders next to the code under `src/` (for example `src/steps/extraction/test/`)

```bash
# Run all tests
pnpm test

# Run affected tests only (fast path for PRs; prints "No tasks were run" when nothing changed)
pnpm affected:test

# Run one package's tests
pnpm -F @contentful/experience-design-system-cli test
```

TUI tests use [`ink-testing-library`](https://github.com/vadimdemedes/ink-testing-library). The CLI's `vitest.config.ts` sets `FORCE_COLOR=3`, so rendered frames contain ANSI codes. Tests that assert on raw strings should strip ANSI codes before comparing.

The CLI's `test` target depends on its `build` target, so `pnpm -F @contentful/experience-design-system-cli test` builds first.

The backend-pipeline package's `vitest.config.ts` runs with `pool: 'forks'` and `retry: 1` for worker isolation. Contributors do not need to configure this, but expect test wall-clock time to reflect per-test process forks rather than a shared worker pool — flaky individual tests retry once before failing the suite.

## Adding a New Package

1. Create `packages/<package-name>/`
2. Add `package.json` with `name: "@contentful/<package-name>"`, `"type": "module"`, and `exports`
3. Add `tsconfig.json` (extends `@tsconfig/node24`), `tsconfig.build.json`, and `project.json` for Nx targets
4. Add `eslint.config.ts`
5. Source goes under `src/`, tests under `test/`

## Adding a New Framework Extractor

Extraction lives in `packages/experience-design-system-backend-pipeline/src/steps/extraction/`:

1. Create `src/framework-adapters/<framework>/extract-<framework>-components.ts` exporting a function that matches the `extract` signature of the `ComponentExtractor` interface in `src/types/component.ts`
2. Register it in `src/services/run-extraction-service.ts` — add an entry (`name`, `fileFilter`, `extract`) to the `extractors` array. Order matters where two extractors claim the same file extension
3. Write tests under `test/` (or a `test/` folder next to the adapter) alongside the existing extractor tests

## Branching and Deployment

- `development` — default integration branch. Branch from it and open PRs against it. Pushes run CI (lint, test, quality) and pull requests into `development` publish dev builds.
- `main` — production, updated by release PRs from `development`. Every push runs a stable, conventional-commit-driven release: version bump, git tag, publish to GitHub Packages, then mirror the new version to the public npmjs.org registry.
- `canary` — pre-release integration branch. Every push publishes a real, tagged `X.Y.Z-alpha.N` prerelease (npm dist-tag `canary`) to GitHub Packages. The release step syncs `main` into `canary` before releasing, so canary always includes everything already on main.
- Any other branch or open PR — no dedicated naming convention is enforced. Every PR (and any push to a non-main, non-canary branch that CI runs on) publishes a throwaway, SHA-stamped dev prerelease (npm dist-tag `dev`) for the Nx-affected packages only, with no git commit/tag/push. If no packages are affected, the release step is a no-op.

## Pull Requests

- PR titles must follow Conventional Commits and reference a Jira ticket, e.g. `[INTEG-1234]` (both validated in CI)
- All tests must pass
- Bito Code Review will automatically review your PR — address or reply to all comments before merging
- Squash merge or rebase merge only — merge commits are disabled at the repo level
- At least one approving code owner review is required before merging

## CI/CD

All CI runs via GitHub Actions (`.github/workflows/ci.yml`):

| Job            | Trigger                                                                                                                                                                                            | What it does                                                                                                                                                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint`         | push to main/canary/development, PR to main or development, merge group                                                                                                                            | ESLint + Prettier via `pnpm affected:lint`                                                                                                                                                                                                                                                    |
| `test`         | push to main/canary/development, PR to main or development, merge group                                                                                                                            | Vitest via `pnpm affected:test`, then `pnpm typecheck` and `pnpm affected:build`                                                                                                                                                                                                              |
| `quality`      | same as `lint`                                                                                                                                                                                     | Quality ratchets: Knip for the CLI (`quality:knip:cli`) and for all other packages (`quality:knip:legacy`, a historical name), and jscpd duplicate detection (`quality:jscpd:legacy`, which skips the CLI's `tui` and `api` folders and backend-pipeline); budgets live in `scripts/quality/` |
| `test-summary` | always, after `lint`/`test`                                                                                                                                                                        | Fails the check if either upstream job failed — a single required status for branch protection                                                                                                                                                                                                |
| `release`      | push to main (excluding automation-bot commits), push to canary (excluding dependabot and automation-bot commits), or any PR targeting main or development, once `lint`, `test` and `quality` pass | Runs `pnpm release` (see Release Process below). Behavior branches internally on `GITHUB_REF` — this is one job, not separate prod/dev jobs                                                                                                                                                   |

A second workflow, `.github/workflows/release-guard.yml`, runs on PR open/sync/reopen and merge-group events. It does not itself gate anything — release concurrency is already serialized by the `release` job's `concurrency.group` in `ci.yml` — but it gives PRs a named check to point at.

The `release` job depends on `lint`, `test` and `quality`. Nx affected detection uses `nrwl/nx-set-shas` to compare `NX_BASE..NX_HEAD`. Only packages with changed files run lint/test/build.

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

| Commit type                         | Version bump  |
| ----------------------------------- | ------------- |
| `fix`                               | patch (0.0.x) |
| `feat`                              | minor (0.x.0) |
| `feat!` or `BREAKING CHANGE` footer | major (x.0.0) |

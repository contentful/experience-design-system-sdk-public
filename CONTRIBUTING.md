# Contributing

## Prerequisites

| Tool    | Version                                 | Notes                                                  |
| ------- | --------------------------------------- | ------------------------------------------------------ |
| Node.js | 24.22.1 (`.nvmrc`); `engines` is `>=24` | `nvm use` switches automatically                       |
| pnpm    | 10.27.0 (pinned by `packageManager`)    | Run `corepack enable`; corepack then uses that version |

## Getting Started

```bash
git clone https://github.com/contentful/experience-design-system-sdk-public.git
cd experience-design-system-sdk-public
pnpm install
pnpm build       # build all packages
pnpm test        # run all tests
pnpm typecheck   # typecheck all packages
```

## Repository Structure

```
packages/
  experience-design-system-cli/              # Published CLI (`experiences`): the Ink TUI that drives the import
  experience-design-system-backend-pipeline/ # Extraction, agents, selection, composition, apply, persistence;
                                             # the CLI bundles it when it builds
  experience-design-system-client/           # Generated API client (from openapi.json), used by the apply step
  experience-design-system-types/            # Shared types, schemas and validation
.github/workflows/                           # CI/CD
scripts/                                     # Release automation, CLI linking, quality ratchets
```

`cli` depends on `backend-pipeline` and `types`; `backend-pipeline` depends on `client` and `types`. Because the CLI bundles `backend-pipeline`, it is a dev dependency of the CLI.

## Development Workflow

### Working on a package

Swap the package name to target another (`@contentful/experience-design-system-backend-pipeline`, `-client`, `-types`).

```bash
pnpm -F @contentful/experience-design-system-cli build
pnpm -F @contentful/experience-design-system-cli test
pnpm -F @contentful/experience-design-system-cli exec vitest run test/commands.test.ts   # one test file
pnpm -F @contentful/experience-design-system-cli typecheck
pnpm -F @contentful/experience-design-system-cli lint        # or lint:fix
```

The client and types packages have a `test:watch` script. For the CLI and backend-pipeline, use `pnpm -F <package> exec vitest`.

### Running the CLI locally

After building, run it from the checkout:

```bash
node packages/experience-design-system-cli/bin/cli.js --version
```

Outside CI, `pnpm build` also runs `scripts/link-cli.js` (the root `postbuild` script), which symlinks the build into your global npm bin directory as `experiences`, `exo` and `experience-design-system-cli`, so `experiences --version` works too.

### Live reload while working on the TUI

```bash
pnpm dev
```

It rebuilds `dist/` whenever the CLI's source changes and restarts the app, so you land back on the Start screen after each save.

- It is a restart, not hot module replacement (Ink has no Fast Refresh), so screen state is lost.
- It writes `dist/index.js` and `dist/app.js` in place and never deletes `dist/`, unlike `pnpm build`.
- It watches only the CLI's own source. After editing another workspace package (for example `backend-pipeline`), rebuild it with `pnpm -F <package> build`.
- `q` quits the app but leaves the watcher running; save a file to start it again. Ctrl+C stops everything.
- It only works from a checkout; the published package does not include the dev script.

### Testing the import wizard against a real codebase

```bash
node packages/experience-design-system-cli/bin/cli.js import
```

You need an interactive terminal and a coding agent on your `$PATH` (`claude` by default; pick another in the Settings menu). The wizard first asks what to import (tokens and components, tokens only, or components only), then asks for the project folder and token file that choice needs, on its own screens.

Extracted components go in the session database; set `EDS_PIPELINE_DB_PATH` to a temp path to leave your real one alone. To push, set your Contentful space ID, environment ID and management token in the Settings menu, or export `CONTENTFUL_SPACE_ID`, `CONTENTFUL_ENVIRONMENT_ID` and `CONTENTFUL_MANAGEMENT_TOKEN`.

## Commit Convention

[Conventional Commits](https://www.conventionalcommits.org/) are enforced by `commitlint`:

```
type(scope): description
```

Valid types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `test`, `perf`, `ci`, `build`, `revert`

```
feat(cli): add an agent picker to the Settings menu
fix(backend-pipeline): handle SVGProps without inflating prop count
chore: update pnpm lockfile
docs: add ARCHITECTURE.md
```

Husky hooks check every commit: `commit-msg` runs `commitlint`, and `pre-commit` runs `pnpm lint:staged` (`lint:fix`, `typecheck` and `test` for the affected projects).

## Tests

The runner is [Vitest](https://vitest.dev/). Tests live in:

- `cli` and `types`: `packages/<name>/test/`
- `backend-pipeline`: `packages/experience-design-system-backend-pipeline/test/`, plus `test/` folders beside the code under `src/` (for example `src/steps/extraction/test/`)

```bash
pnpm test                                                 # all tests
pnpm affected:test                                        # affected only (prints "No tasks were run" if nothing changed)
pnpm -F @contentful/experience-design-system-cli test     # one package
```

TUI tests use [`ink-testing-library`](https://github.com/vadimdemedes/ink-testing-library). The CLI's `vitest.config.ts` sets `FORCE_COLOR=3`, so rendered frames contain ANSI codes; strip them before comparing strings. The CLI's `test` target depends on its `build` target, so it builds first.

Backend-pipeline tests run with `pool: 'forks'` and `retry: 1` for worker isolation. Expect wall-clock time to reflect per-test process forks, and a flaky test retries once before failing the suite.

### End-to-end import tests

`packages/experience-design-system-cli/test/e2e/` runs the real app through each import choice by sending a person's keystrokes. Only the agent and Contentful are fake, so no network, agent or Contentful space is needed. They run with the other CLI tests, or on their own:

```bash
# All three scenarios (run `pnpm build` first: they use the built packages)
pnpm -F @contentful/experience-design-system-cli exec vitest run test/e2e

# One scenario: "both", "components only" or "tokens only" (this form builds first)
pnpm nx test experience-design-system-cli -- -t "tokens only"
```

`test/e2e/fixtures/` is a copy of another project's components and token file; do not edit it. `ARCHITECTURE.md` explains how the fakes work.

## Adding a New Package

1. Create `packages/<package-name>/`
2. Add `package.json` with `name: "@contentful/<package-name>"`, `"type": "module"` and `exports`
3. Add `tsconfig.json` (extends `@tsconfig/node24`), `tsconfig.build.json` and `project.json` for Nx targets
4. Add `eslint.config.ts`
5. Put source under `src/` and tests under `test/`

## Adding a New Framework Extractor

Extraction lives in `packages/experience-design-system-backend-pipeline/src/steps/extraction/`:

1. Create `src/framework-adapters/<framework>/extract-<framework>-components.ts`, exporting a function that matches the `extract` signature of the `ComponentExtractor` interface in `src/types/component.ts`.
2. Register it in `src/services/run-extraction-service.ts` by adding an entry (`name`, `fileFilter`, `extract`) to the `extractors` array. Order matters where two extractors claim the same file extension.
3. Write tests under `test/` (or a `test/` folder beside the adapter), next to the existing extractor tests.

## Branching and Deployment

- **`development`**: the default integration branch. Branch from it and open PRs against it. Pushes run CI (lint, test, quality), and PRs into `development` publish dev builds.
- **`main`**: production, updated by release PRs from `development`. Every push runs a stable, conventional-commit-driven release (see Release Process).
- **`canary`**: pre-release integration. Every push publishes a tagged `X.Y.Z-alpha.N` prerelease (npm dist-tag `canary`) to GitHub Packages. The release step first syncs `main` into `canary`, so canary always includes everything on main.
- **Any other branch or PR**: no naming convention is enforced. Each PR (and each push to a non-main, non-canary branch that CI runs on) publishes a throwaway, SHA-stamped prerelease (dist-tag `dev`) for the Nx-affected packages only, with no git commit or tag. If nothing is affected, the step does nothing.

## Pull Requests

- Titles follow Conventional Commits and reference a Jira ticket, for example `[INTEG-1234]` (both checked in CI).
- All tests must pass.
- Bito Code Review reviews your PR automatically; address or reply to every comment before merging.
- At least one approving code owner review is required.
- The repo allows merge commits, squash and rebase. PRs into `development` are normally merged with a merge commit. A release PR (`development` into `main`) must use a merge commit, never squash: a squash drops `development` as a parent and brings conflicts back on the next release.

## CI/CD

CI runs in GitHub Actions (`.github/workflows/ci.yml`). Nx affected detection uses `nrwl/nx-set-shas` to compare `NX_BASE..NX_HEAD`, so only changed packages run lint, test and build.

| Job            | Runs on                                                                                                                                                       | What it does                                                                                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lint`         | push to main/canary/development; PR to main or development; merge group                                                                                      | ESLint and Prettier via `pnpm affected:lint`                                                                                                                                                                                                                                               |
| `test`         | same as `lint`                                                                                                                                                | `pnpm affected:test`, then `pnpm typecheck` and `pnpm affected:build`                                                                                                                                                                                                                      |
| `quality`      | same as `lint`                                                                                                                                                | Quality ratchets, with budgets in `scripts/quality/`: Knip for the CLI (`quality:knip:cli`) and for the other packages (`quality:knip:legacy`, a historical name), and jscpd duplicate detection (`quality:jscpd:legacy`, which skips the CLI's `tui` and `api` folders and backend-pipeline) |
| `test-summary` | always, after `lint` and `test`                                                                                                                               | Fails if either upstream job failed, giving branch protection one required status                                                                                                                                                                                                          |
| `release`      | push to main or canary (excluding automation-bot commits, and dependabot on canary), or any PR to main or development, once `lint`, `test` and `quality` pass | Runs `pnpm release`. It is one job that branches on `GITHUB_REF`, not separate prod and dev jobs                                                                                                                                                                                           |

A second workflow, `.github/workflows/release-guard.yml`, runs on PR open, sync and reopen and on merge-group events. It gates nothing (the `release` job's `concurrency.group` already serializes releases) but gives PRs a named check.

## Release Process

Releases are automated by `scripts/release.js` (`pnpm release`, run by the `release` job). **You never bump versions or create tags by hand.** The commit type decides the bump: `fix` is a patch, `feat` a minor, and `feat!` or a `BREAKING CHANGE` footer a major. It branches on the triggering ref:

**`main` (stable release):**

1. Nx Release reads the conventional commits since the last tag to pick the version bump.
2. It commits the bump, tags it and pushes to `main`.
3. It publishes the new version to GitHub Packages.
4. If a new tag now points at `HEAD`, a follow-up CI step mirrors the version to the public npmjs.org registry via OIDC trusted publishing.

After a stable release, merge `main` back into `development` with a merge commit, in a PR titled like `chore: merge main into development after the X.Y.Z release [INTEG-1234]`. The release commit (version bump and tag) exists only on `main`, so `development` stays one commit behind until you do.

**`canary` (pre-release):**

1. Sync `main` into `canary`.
2. Nx Release computes an `X.Y.Z-alpha.N` version from the conventional commits.
3. Commit, tag and push the prerelease to `canary`.
4. Publish to GitHub Packages under the dist-tag `canary`.
5. Exit without publishing if there are no releasable changes since the last canary tag.

**Any other branch or PR (dev build):**

1. Find the Nx-affected packages; exit if none changed.
2. Publish a throwaway prerelease per affected package, versioned `<version>-dev-build-<git-sha>`, under the dist-tag `dev`.
3. No git commit, tag or push, so dev builds leave nothing in the repo.

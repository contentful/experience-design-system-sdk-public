# scripts

Repo-only tooling for working on this package. Nothing in here is published: the package's `files` list is `bin/`,
`dist/` and `legacy/`, so `scripts/` never reaches an install. Code in `src/` that needs one of these scripts must
check that it exists and say so when it does not (see `src/commands/watch.ts`).

| Script | What it does | How to run it |
| --- | --- | --- |
| `dev.mjs` | Rebuilds `dist/` with esbuild whenever the source changes and restarts the TUI. Never deletes `dist/` or `legacy/`. | `experiences import --watch`, `pnpm dev`, or `pnpm -F @contentful/experience-design-system-cli dev` |

Repo-wide tooling (linking the CLI globally, releases, the quality ratchets) lives in the root `scripts/` folder.

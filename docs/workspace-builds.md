# Workspace builds

```sh
pnpm build
```

The command builds all four workspace packages in one Nx task graph, then runs the local CLI-linking hook. Dependency order is still enforced; the build is not affected-only or partial.

## Task graph

- `build` depends on `^build` only. It no longer runs each package's `clean` target first.
- The CLI `build` and `compile-app` targets are no-op aggregates. `build` depends on `compile` and `copy-assets`, so Nx runs them in the same graph instead of starting nested `nx run` processes. Do not pass `--excludeTaskDependencies` to an aggregate; it skips the work.
- CLI `compile` bundles `index.ts` and `app.tsx` in one esbuild task with one declaration pass. `dist/index.js`, `dist/app.js` and the declaration files keep their previous paths.
- CLI `copy-assets` copies the generation and selection skill Markdown and the backend prompts. It is cached, with the copied source files as inputs and `skills/` and `prompts/` as outputs, so editing a skill invalidates only the copy.
- The types package now depends on `^build` instead of `^clean`.

## Live runtime output

A linked CLI runs straight from the workspace `dist` directories, so an import can be loading modules while another build runs. Cleaning an output directory, or replacing it with a cached copy, can briefly remove modules an import is about to load.

Builds therefore keep existing output in place:

- The types, client and backend TypeScript builds use `clean: false` and are not cached.
- CLI `compile` uses `deleteOutputPath: false` and is not cached.
- Client code generation and CLI `copy-assets` stay cached. Neither writes into a `dist` directory.

The cost is that a file removed or renamed in source stays in `dist` until an explicit clean:

```sh
pnpm clean && pnpm build
```

A clean must be followed by a full build before using the linked runtime. Clean before building a package for publication from a local checkout. CI release jobs start from a fresh checkout with no `dist` directories and no shared Nx cache, so they never see stale output.

## Local measurements

Measured on a 12-core laptop with `NX_DAEMON=false CI=1`, comparing the previous graph with this one. Each figure is the range of two runs. Other work was running on the machine, so treat them as rough and not as CI latency guarantees.

| Build | Before | After |
|---|---|---|
| `pnpm build --skip-nx-cache`, empty `dist` | 14.9–25.4 s | 9.8–14.5 s |
| `pnpm build`, unchanged, cache warm | 2.8–3.2 s | 8.3–9.7 s |
| `nx build experience-design-system-cli --skip-nx-cache` | 16.1–21.9 s | 8.9–13.0 s |

Uncached builds are faster because the graph is no longer nested and the CLI compiles once. Unchanged builds are slower because the compiled outputs are no longer restored from cache; only code generation and asset copying are skipped. The built `dist` trees for all four packages, and the CLI `skills/` and `prompts/` folders, are byte-identical to the previous build.

For a task-level trace:

```sh
NX_DAEMON=false NX_PROFILE=workspace-build.json pnpm build
```

The trace records wall time and cache status per task. Parallel durations do not add up to total wall time.

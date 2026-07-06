# PTY test coverage plan

Living doc for what the PTY harness should exercise on the `experiences` CLI. The goal isn't 2^50 combinations — it's a matrix of representative flag combinations chosen so every branch of the flag-validation and orchestration code is entered end-to-end at least once, and every UI state the wizard can render is observed at least once by a real terminal.

---

## Implementation status — pick up here

Last updated: 2026-07-06 on branch `feat/integ-4406-pty-harness-mcp`, rebased on `feat/dsi-tui-wizard-mega` at `5b64783` (post-PR #91). **Pushed to origin.**

**What's implemented (61 tests, all green):**

- **Tier 1 (smoke, 3 tests):** `01-welcome.pty.test.mjs`, `02-run-picker.pty.test.mjs`, `03-ctrl-c-exits.pty.test.mjs`.
- **Tier 2 (validation, 20 tests):** `10-import-validation.validation.test.mjs`. Every `process.exit(1)` branch in `packages/experience-design-system-cli/src/import/command.ts`.
- **Tier 3a — headless (11 tests):** `20-import-headless.validation.test.mjs`. `--skip-apply`, `--print-prompt`, `--dry-run` (with/without deprecation notice), `--skip-analyze`, `--agent` routing, `--yes`, env-var credentials, `--verbose`, `--out`.
- **Tier 3b — PTY flag→state (7 tests):** `30-import-flag-to-state.pty.test.mjs`. `--project`, tokens-skip, `--auto-accept-scope`, `--no-push`, `--out-dir`, `--agent codex` routing, control test that scope-gate DOES render without `--auto-accept-scope`.
- **Tier 3b — selection & pipeline flags (6 tests):** `40-import-selection.validation.test.mjs`. `--deselect` (single + multi), `--select-all`, `--print + --out` writes real `components.json`, `--model haiku` reaches agent argv (via STUB_ARGV_LOG), `--agent codex` invokes only the codex binary.
- **Tier 3b — custom prompt paths (3 tests):** `50-import-custom-prompts.validation.test.mjs` + `51-import-generate-prompt.pty.test.mjs`. `--select-prompt-path` warns + echoes path headlessly (with a `.md` warning variant); `--generate-prompt-path` renders the wizard's CustomPromptBanner with the resolved path.
- **Tier 3b — runs-based flags (4 tests):** `60-import-runs.pty.test.mjs`. `--push-from-run` headless (missing-creds error), `--push-from-run` PTY (renders "Push run <id>" CredentialsStep), `--modify` PTY (reaches "Loading generated definitions"), and a run-not-found guard.
- **Tier 3b — apply push against mock EMA (7 tests):** `70-apply-push.validation.test.mjs` + `helpers/mock-ema.mjs`. `--host + --yes` drives preview → apply, `--cma-token` becomes `Authorization: Bearer`, `--dry-run` stops after preview, `--host` routes to the mock, `--yes` requirement in non-interactive mode, 400 preview error surfaces, 401 users/me error surfaces.

**Fixtures:**

- `fixtures/projects/react-minimal/` — Button, Card, Icon (3-component React library).
- `fixtures/components/react-minimal.components.json` — pre-baked CDF the wizard produced against the fixture. Used by push tests to skip pipeline.

**Helpers:**

- `tests/helpers/tmp-home.mjs` — per-test isolated `HOME`.
- `tests/helpers/run-cli.mjs` — headless CLI spawn.
- `tests/helpers/fixtures.mjs` — fixture paths (`REACT_MINIMAL`, `REACT_MINIMAL_COMPONENTS_JSON`).
- `tests/helpers/seed-runs.mjs` — write a `RunRecord` to `<home>/.config/experiences/runs.json`.
- `tests/helpers/mock-ema.mjs` — in-process HTTP mock of Contentful EMA push endpoints (`/users/me`, `/imports/preview`, `/imports/apply`, apply-poll). `.stub(method, urlPattern, handler)` overrides per test; `.requests` records every hit.
- Stub agent (`src/stub-agent.mjs`) emits `classify_component` + `classify_prop` per detected prop; supports `STUB_ARGV_LOG` to record its invocation argv so tests can assert on flag pass-through (`--model`, `--agent`).

**Locked-in decisions:**

1. **Fixture strategy:** hand-crafted 3-component React library.
2. **Push mocking:** in-process HTTP server on 127.0.0.1 (not nock — CLI runs in a child process; nock can't cross the boundary).
3. **Parallelism:** `maxWorkers: 4`.
4. **Real agents:** stub by default; MCP server has a `stub_agents: false` opt-in.

**Remaining Tier 3 flags without dedicated coverage (pick up here):**

- `--auto-filter` — shows the AI-filter banner. NB: probe showed this steers the wizard back to WelcomeStep unexpectedly on the mega branch; investigate before writing.
- `--no-auto-filter` — no filter banner; scope-gate has NO "AI recommended exclusions" section. Straightforward PTY test.
- `--no-live-preview` — final-review with no auto re-render after FieldEditor save. Needs to actually reach final-review.
- `--exclude-invalid` — scope-gate auto-drops invalid entries. Needs a fixture component with an invalid name or a validation-failing prop.
- `--force` — bypasses staleness on `--push-from-run` / `--modify`. Needs a stale seeded run (fingerprint mismatch); test both directions (without --force errors, with --force proceeds).
- `--modify --overwrite` / `--modify --save-as-new` — save-path semantics. Needs seeded pipeline.db so `--modify` actually loads a session.
- `--on-conflict overwrite/skip/fail` write path — needs pre-existing file at save path AND the wizard's save-conflict gate (which needs a completed generate step in-PTY).
- `--select "Button*"` / `--deselect "Icon*"` in PTY mode — the flags only affect headless pipeline today; if they should reach the wizard's scope-gate (as originally documented), that's a bug worth confirming/fixing.
- `--host` on `import` (not `apply push`) — hooked into the wizard's `WizardApp` prop; assert via banner or wizard state.
- `--viewports <path>` — passed to apply-push; needs a viewports fixture + push test.
- Interactive `--yes` on the wizard push-confirmation path — requires driving through generate + save + push in-PTY.
- Push confirmation (interactive) with breaking-changes gate — requires mock EMA returning `changed` with `breaking` classification.

Recommended sequencing:
1. `--no-auto-filter` / `--auto-filter` / `--exclude-invalid` — all PTY, no new infra.
2. `--force` — needs a "stale run" seed helper (or seeding a fingerprint mismatch).
3. `--modify` with seeded pipeline.db — biggest unlock; enables 4-5 more flags.
4. Push-confirmation flows through the wizard (`--yes`, `--host` on import, breaking-changes gate) — needs both seed helpers and mock EMA.

**Open questions still unanswered (only matter for Tier 3+):**

- Should we add a nightly non-blocking CI job that runs a golden-path test against real `claude` on a self-hosted runner?

**How to continue:**

1. Read the tier table below to pick the next tranche (Tier 3 is the natural next step once the fixture lands).
2. New validation tests go in `*.validation.test.mjs` (headless spawn). New wizard-state tests go in `*.pty.test.mjs` (real PTY). Vitest picks up both when `PTY_TESTS=1`.
3. Every test must use `makeTmpHome()` — no shared HOME, ever.
4. Run locally: `pnpm exec nx run dsi-pty-harness:pty-test` (builds the CLI first).

---

## Scope boundary

**PTY harness owns:** behaviors that require a real terminal — raw-mode input, `useStdin` mounting, focus, cursor position, Ink re-renders, PTY resize, ctrl-c, real `child_process` spawns. Anything that produces a distinguishable *rendered screen* is fair game.

**Vitest/ink-testing-library still owns:** pure-React logic (frame diffs, prop transitions, hook state), argument-parsing tests that don't need a terminal (`test/import/flags.test.ts` etc.), and mocked-agent unit tests. The PTY suite should not re-implement those.

**Out of scope:** anything that hits the real Contentful API or a real LLM. Every test runs against the stub agent; every test that needs credentials feeds them from a fixture, not env.

## The surface — where flags live

Five top-level subcommands, each with its own flag set:

| Command | Source | Notable |
|---|---|---|
| `import` | `src/import/command.ts` (492 lines) | ~50 flags, ~15 mutex rules, the wizard entry point |
| `generate components` / `generate tokens` | `src/generate/command.ts` | agent/model resolution, prompt overrides, `--dry-run` vs `--print-prompt` |
| `analyze extract` / `analyze select-agent` | `src/analyze/command.ts` | `--dir`, `--show-rationale`, `--json` |
| `apply push` / `apply diff` / `apply select` | `src/apply/command.ts` | credentials, `--select`/`--deselect`, `--yes`/`--force`/`--dry-run` |
| `print components` / `print tokens` / `print validate` | `src/print/command.ts` | `--session`, `--out`, path-based inputs |

Plus wizard-only interactive states (no flag): welcome, run-picker, credentials, scope-gate, batch-skip prompt, custom-prompt banner, live preview, final review, save-conflict gate, push progress.

Every PTY test targets one of two flavors:

1. **CLI-invocation coverage** — flag → wizard state → assertion. Verifies that a given flag combination lands the wizard in the state the flag was designed to reach (or exits with the documented error).
2. **Interactive-state coverage** — for a given wizard state, does each key stroke advance/retreat/toggle/select correctly? These usually chain off a CLI-invocation test.

## Fixtures — what a test spawns against

The wizard reads three inputs from disk / env: a project path (source components), `~/.config/experiences/credentials.json`, and `~/.config/experiences/runs.json`. Each PTY test gets an isolated `HOME` via `makeTmpHome()` and seeds only the files that specific test needs.

Fixtures live in `tools/dsi-pty-harness/fixtures/`:

- `fixtures/projects/react-minimal/` — a tiny React component library the wizard can extract from (currently we point tests at a stub path; a real fixture unblocks the full extract → generate → review path).
- `fixtures/projects/vue-minimal/`, `svelte-minimal/` — for parser routing.
- `fixtures/tokens/valid.dtcg.json`, `raw-scss/`, `raw-css-vars/`, `raw-style-dictionary/` — token inputs.
- `fixtures/runs/one-completed.json`, `many.json`, `broken.json` — run-picker seed states.
- `fixtures/credentials/authed.json`, `unauthed.json`, `custom-agent.json` — credential seed states.
- `fixtures/viewports/desktop-only.json`, `full.json` — viewport overrides.

Any test that doesn't need a fixture uses `stubAgentEnv` alone and a nonexistent project path (the wizard's welcome step accepts arbitrary text before validating).

## Coverage matrix — `experiences import`

Each row is one PTY test. **Priority** is the tier the test lands in (see next section). **Wizard state reached** is the terminal state the test asserts on. **Existing** notes if a non-PTY test already covers the *logic* (in which case the PTY test is verifying the wired terminal path only).

### Tier 1 — smoke / already-ported (currently in the suite)

| # | Command | State reached | Asserts | Existing |
|---|---|---|---|---|
| 1 | `import` (no runs) | welcome step | prompt renders, accepts text, advances | ✅ `01-welcome.pty.test.mjs` |
| 2 | `import` (1 seeded run) | run-picker → welcome via `n` | picker offers "start new" | ✅ `02-run-picker.pty.test.mjs` |
| 3 | `import` + ctrl-c | process exit | pid gone | ✅ `03-ctrl-c-exits.pty.test.mjs` |

### Tier 2 — every mutex-validated flag combination ✅ DONE

**Status:** all 20 rules implemented in `tests/10-import-validation.validation.test.mjs`. Runs headless (no PTY needed) via `helpers/run-cli.mjs`. Fires in ~8s. When you add a new mutex rule to `import/command.ts`, add a case here.

Every branch in `command.ts` that ends in `process.exit(1)`:

| # | Flag combination | Expected exit / stderr |
|---|---|---|
| 4 | `--push-from-run X --modify Y` | 1, "mutually exclusive" |
| 5 | `--push-from-run X --project /some/path` | 1, "read from the recorded run" |
| 6 | `--push-from-run X --no-save` | 1, "never writes to disk" |
| 7 | `--push-from-run X --no-push` | 1, "Pushing is the whole point" |
| 8 | `--overwrite --push-from-run X` | 1, "only apply with --modify" |
| 9 | `--save-as-new --push-from-run X` | 1, "only apply with --modify" |
| 10 | `--modify X --project /path` | 1, "read from the recorded run" |
| 11 | `--modify X --overwrite --save-as-new` | 1, "mutually exclusive" |
| 12 | `--overwrite` (no --modify) | 1, "require --modify" |
| 13 | `--save-as-new` (no --modify) | 1, "require --modify" |
| 14 | `--no-save --no-push` | 1, "would do nothing" |
| 15 | `--no-save --out-dir /tmp` | 1, "mutually exclusive" |
| 16 | `--no-save --on-conflict overwrite` | 1, "mutually exclusive" |
| 17 | `--raw-tokens X --tokens Y` | 1, "mutually exclusive" |
| 18 | `--raw-tokens /nonexistent.scss` | 1, "file not found" |
| 19 | `--on-conflict bogus` | 1, "invalid --on-conflict value" |
| 20 | `--push-from-run bogus-id` | 1, run-lookup error message |
| 21 | `--modify bogus-id` | 1, run-lookup error message |

**Why PTY, not unit tests?** These already have unit coverage in `test/import/flags.test.ts` (3 rules) — the PTY versions verify the actual `process.exit(1)` path exits with code 1 through commander, not just that the function throws. Cheap to add; catches wire-up bugs where a validation returns instead of exits.

### Tier 3 — flag → wizard state (each flag steers the wizard to a distinct path)

One test per steering flag, asserting the state reached.

Status legend: ✅ = implemented (with test file), ⏭️ = deferred, blank = TODO.

| # | Status | Flag | Wizard state | Notes / test file |
|---|---|---|---|---|
| 22 | ✅ | `import` (fresh) | welcome | `01-welcome.pty.test.mjs` |
| 23 | ✅ | `import --project <fixture>` | Design tokens | `30-import-flag-to-state.pty.test.mjs` |
| 24 |  | `import --skip-analyze` | select or scope-gate | needs seeded pipeline.db |
| 25 |  | `import --skip-generate` | apply or exits | error surface |
| 26 | ✅ | `import --skip-apply` | terminates after generate | Tier 3a `20-import-headless…` |
| 27 | ✅ | `import --no-push` | save-path prompt (no push) | `30-import-flag-to-state.pty.test.mjs` |
| 28 | ⏭️ | `import --no-save` | pushes without disk write | needs full push-through-wizard flow |
| 29 | ✅ | `import --auto-accept-scope` | skips scope-gate | `30-import-flag-to-state.pty.test.mjs` |
| 30 |  | `import --exclude-invalid` | scope-gate auto-drops invalid | fixture needs invalid rows |
| 31 |  | `import --auto-filter` | shows filter progress | probe showed unexpected routing — investigate |
| 32 |  | `import --no-auto-filter` | jumps to manual scope-gate | filter banner absent |
| 33 |  | `import --no-live-preview` | final review, no auto-preview | need to reach final-review |
| 34 | ⏭️ | `import --yes` | skips push confirmation | needs push-through-wizard flow |
| 35 |  | `import --force` | bypasses staleness check | needs stale seeded run |
| 36 | ✅ | `import --verbose` | shows full progress | Tier 3a |
| 37 | ✅ | `import --print` | writes components.json | `40-import-selection.validation.test.mjs` |
| 38 | ✅ | `import --out /tmp/xyz` | uses custom out dir | Tier 3a |
| 39 | ✅ | `import --out-dir /tmp/xyz` | bypasses inline save prompt | `30-import-flag-to-state.pty.test.mjs` |
| 40 | ⏭️ | `import --on-conflict overwrite` | replaces existing file | needs push-through-wizard flow (headless --print ignores it) |
| 41 | ⏭️ | `import --on-conflict skip` | writes to timestamped subdir | same |
| 42 | ⏭️ | `import --on-conflict fail` | exits non-zero | same |
| 43 | ✅ | `import --select-prompt-path /path.md` | banner names custom prompt | `50-import-custom-prompts.validation.test.mjs` |
| 44 | ✅ | `import --generate-prompt-path /path.md` | banner names custom prompt | `51-import-generate-prompt.pty.test.mjs` |
| 45 | ⏭️ | `import --host https://api.flinkly.com` | staging routing | needs push-through-wizard flow (apply push covered) |
| 46 |  | `import --viewports /path.json` | passes viewports to push | needs viewports fixture + push |
| 47 | ✅ | `import --push-from-run <valid>` | jumps to push directly (creds prompt) | `60-import-runs.pty.test.mjs` |
| 48 | ✅ | `import --modify <valid>` | opens at final-review (load state) | `60-import-runs.pty.test.mjs` |
| 49 |  | `import --modify X --overwrite` | saves to recorded savePath | needs seeded pipeline.db |
| 50 |  | `import --modify X --save-as-new` | prompts for new path | needs seeded pipeline.db |
| 51 | ✅ | `import --agent codex` | routes agent-runner via env override | `30-…` + `40-…` |
| 52 | ✅ | `import --model haiku` | passes model to agent | `40-import-selection.validation.test.mjs` |
| 53 |  | `import --select "Button*"` | pre-selects matching | wizard scope-gate doesn't honor this flag today — file a bug |
| 54 | ✅ | `import --deselect "Icon*"` | pre-deselects matching (headless) | `40-import-selection.validation.test.mjs` |
| 55 | ✅ | `import --select-all` | selects all extracted (headless) | `40-import-selection.validation.test.mjs` |
| 56 |  | `import --raw-tokens fixtures/tokens/raw-scss/vars.scss` | classifies raw tokens | needs raw-tokens fixture |

**apply push flags** (`70-apply-push.validation.test.mjs`, all against mock EMA):

| Status | Flag | Assertion |
|---|---|---|
| ✅ | `apply push --host <mock> --yes` | preview + apply fire against the mock |
| ✅ | `apply push --cma-token <token>` | Authorization: Bearer <token> on every call |
| ✅ | `apply push --dry-run` | stops after preview; no apply call |
| ✅ | `apply push` (no --yes, non-TTY) | exits 1 with "requires --yes" |
| ✅ | 400 on preview | error surfaces with status |
| ✅ | 401 on users/me | error surfaces with "token is invalid" |
| 57 | `import --tokens fixtures/tokens/valid.dtcg.json` | uses pre-classified tokens | skips classification |
| 58 | `import --no-cache` | re-runs all steps | no `[cached]` markers |
| 59 | `import --print-prompt` | prints prompt to stdout, exits 0 | no wizard renders |
| 60 | `import --dry-run` | prints prompt with deprecation notice on stderr | notice visible |
| 61 | `import --space-id X --environment-id Y --cma-token Z` | skips credentials prompt | no credentials wizard step |
| 62 | `import --skip-apply --space-id X` | ignores credentials (unused) | works without env-id or token |

### Tier 4 — interactive keystroke coverage per wizard state

For each wizard state a Tier 3 test reaches, drive the keystrokes that mutate that state and assert the resulting frame.

| State | Keys to exercise | Assert |
|---|---|---|
| Welcome | text entry, ctrl-u, backspace, enter, esc | path validation runs / dialog cancels |
| Run picker | up, down, `n`, `p` (push), `m` (modify), digit, enter | matches shouldShowRunPicker branches |
| Credentials | tab (space→env→token→submit), esc, empty submit | validation errors surface |
| Scope-gate | space (toggle), a (accept all), r (reject all), pageDown, enter, esc | selection state changes match keystrokes |
| Batch-skip prompt | y, n, enter | batch marked skipped / included |
| Custom-prompt banner | enter (dismiss) | banner disappears |
| FieldEditor (final review) | text edits, enter (save), esc (cancel), tab (move) | field commits/reverts |
| Save-conflict gate | o (overwrite), s (skip), f (fail) | matches --on-conflict semantics |
| Push confirmation | y, n, enter | push runs / aborts |
| Push progress | passive — no input | rows advance, final status renders |

### Tier 5 — non-`import` subcommands

Same pattern per command. Fewer flags, mostly one-shot.

| Command | Flags to cover | Notes |
|---|---|---|
| `analyze extract --dir <path>` | `--dir`, `--out`, `--json` | pure output; simpler than wizard |
| `analyze select-agent --show-rationale [--json] [--session <id>]` | rationale view | read-only session DB |
| `generate components` | `--agent`, `--model`, `--verbose`, `--dry-run`, `--print-prompt`, `--session`, `--tokens`, `--token-map`, `--generate-prompt-path` | agent stub coverage |
| `generate tokens` | `--raw-tokens`, `--session` | classification path |
| `apply diff` | `--components`, `--tokens`, `--session`, `--cma-token`, `--host` | preview only |
| `apply push` | + `--yes`, `--verbose`, `--force`, `--dry-run` | mutations |
| `apply select` | `--select-all`, `--select`, `--deselect`, `--force` | interactive selector TUI |
| `print components/tokens/validate` | `--session`, `--out`, `--components`, `--tokens` | file output |

### Tier 6 — cross-cutting

| Concern | Test |
|---|---|
| Non-TTY invocation | Run with `TERM=dumb`/no PTY; verify graceful degradation or documented error |
| PTY resize | `term.resize(cols, rows)` mid-render; assert layout adapts |
| Ctrl-c at every state | Sends SIGINT during welcome, scope-gate, generate, final-review, push |
| Ctrl-c during network call | Aborts in-flight push cleanly, exit code 130 |
| Runs.json migration | Seed v1/v2/v3 formats; verify picker still reads |
| Broken runs.json | Malformed JSON → picker skipped, wizard starts fresh with warning |
| Missing credentials.json | New credentials path prompted; verify persistence |
| `EDS_AGENT_BINARY_CLAUDE` override | Set to a script that exits non-zero; wizard surfaces the error |
| PATH-shadow legacy path | Ensure the `EDS_AGENT_BINARY_*` env override is preferred over PATH |

## What we're NOT going to test

Explicit — write it down so we don't get pulled back into it:

- Every possible `--select <pattern>` regex. One valid, one invalid, one that matches nothing.
- Every possible `--host` URL. `flinkly.com` (staging) and `api.contentful.com` (prod default) is enough.
- Every possible model / agent combination. Cover the four supported agent names (claude/codex/opencode/cursor) once each; models are opaque strings the stub echoes.
- Every raw-token format. Cover SCSS, CSS vars, JS/TS, Style Dictionary once each. Format-specific parsing is unit-tested.
- Real network. Ever. Push tests hit a local http mock or the stub returns success.
- Combinations of Tier 3 flags that don't interact. `--verbose --yes` is the union of two independent flags; no combined test needed unless a bug says otherwise.

## Prioritization / ordering

Cross-reference with the "Implementation status" block at the top of this file.

1. **✅ Done — CI regression net + representative flag coverage:** Tier 1 (3) + Tier 2 (20) + Tier 3a headless (11) + Tier 3b PTY flag→state (7) + selection & pipeline (6) + custom prompts (3) + runs-based (4) + apply push against mock EMA (7) = **61 tests**.
2. **⏭️ Next — remaining Tier 3 flags:** see the table row-by-row. The natural next tranche is `--no-auto-filter`, `--exclude-invalid`, and `--force` (each with a bounded infra addition). After that, pipeline.db seeding unlocks `--modify --overwrite`/`--save-as-new` and interactive push-through-wizard flows.
3. **Tier 4** — keystroke coverage per wizard state. Largely folded into 3b (scope-gate control test, save-path prompt bypass, credentials step prompt).
4. **Tier 5** — non-`import` subcommands: `analyze extract` / `analyze select-agent`, `generate components` / `generate tokens`, `apply diff` / `apply select` (`apply push` already covered), `print components/tokens/validate`.
5. **Tier 6** — cross-cutting: non-TTY invocation, PTY resize, ctrl-c at every state, runs.json migration (v1/v2/v3), broken runs.json, missing credentials.json, `EDS_AGENT_BINARY_*` malformed binary.

**Rough sizing** (a future agent's day-of-work budget):

| Phase | Tests to add | New infra | Est. |
|---|---|---|---|
| Fixture: `react-minimal` | 0 tests | 3 tsx files, tokens.json, package.json | 2–3 h |
| Tier 3 | ~40 | one small helper per state reached | 1–2 days |
| Tier 4 | overlaps with Tier 3 (per-state key exercises) | — | folded into Tier 3 |
| Tier 5 | ~30 | per-subcommand test files, split by command | 1 day |
| Tier 6 | ~10 | non-TTY spawn variant, PTY resize helper | 4–6 h |

## Assertion patterns — what "passing" looks like

Prefer these, in order:

1. **Screen contains a specific string** — most robust to Ink re-renders. `waitFor('Where is your component library?')`.
2. **Screen matches a regex** — for content that varies (component counts, timestamps). `waitFor(/Found \d+ component/)`.
3. **Screen does NOT contain a string** — for "step was skipped". `expect(screen).not.toMatch(/credentials/)`.
4. **Process exit code** — for validation-error paths. Wait for `harness.isExited()`, read `getExitInfo().exitCode`.
5. **Side-effect on disk** — for `--out` / `--out-dir` / `--print`. Assert the file exists and parses.

**Anti-patterns to avoid:**

- Sleeping for a fixed duration. Always use `waitFor`.
- Asserting on ANSI escape codes. Use `getScreen()` (stripped), not `getRaw()`.
- Depending on cursor position or terminal width absent an explicit resize. The default is 120×40; tests that need something else set `cols`/`rows` explicitly.
- Chaining assertions across a `waitFor` timeout without cleanup — always `try/finally` around `await w.close()`.

## Structural conventions

- One file per wizard state or logical flag group. Not one giant file.
- Filename: `NN-<topic>.pty.test.mjs`. `NN` orders them for humans; vitest runs them in parallel by default (each in its own PTY, no shared state).
- Every test: `makeTmpHome()` → `spawnWizard()` → assertions → `w.close()` in a `finally`.
- Use `waitFor` timeouts of 10–20s. The default 5s trips on cold-start `experiences` invocations.
- If a test needs a real project fixture, resolve it from `fileURLToPath(new URL('../fixtures/projects/...', import.meta.url))` — don't hardcode `/tmp/...`.

## Success metric

- **CI green:** the `pty-test` job passes on every PR that touches `packages/experience-design-system-cli/src/**/tui/**` or the wizard's supporting orchestration.
- **Every `process.exit(1)` in `command.ts` has a Tier-2 test that hits it.**
- **Every wizard state named in Tier 4 has at least one Tier-3 test that reaches it, and a Tier-4 test that exercises the state's key bindings.**
- **A grep for `.option(` in `src/**/command.ts` returns no flag without a matching test file name in `tools/dsi-pty-harness/tests/`.** (Loose match; some flags will share a test.)

## Open questions

Resolved 2026-07-06 (see the "Locked-in decisions" block at the top):

1. ✅ Real project fixture — hand-crafted 3-component set at `fixtures/projects/react-minimal/`.
2. ✅ Mocked push endpoint — HTTP layer (nock/msw), not an in-CLI env override.
3. ✅ Parallelism — `maxWorkers: 4` (already configured in `vitest.config.ts`).

Still open (only matters for Tier 3+):

4. **Real-agent smoke:** should we add a nightly (non-blocking) job that runs a golden-path test against real `claude` on a self-hosted runner? Value: catches CLI/agent contract drift. Blocked on: whether we have a self-hosted runner budget.

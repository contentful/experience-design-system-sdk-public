# PTY test coverage plan

Living doc for what the PTY harness should exercise on the `experiences` CLI. The goal isn't 2^50 combinations — it's a matrix of representative flag combinations chosen so every branch of the flag-validation and orchestration code is entered end-to-end at least once, and every UI state the wizard can render is observed at least once by a real terminal.

---

## Implementation status — pick up here

Last updated: 2026-07-07 on branch `feat/integ-4406-pty-harness-mcp`, rebased on `feat/dsi-tui-wizard-mega` at `5b64783` (post-PR #91). **Pushed to origin.**

**What's implemented (161 tests, all green in isolation; two pre-existing PTY-timing flakes remain in 61/62 under parallel load — see HANDOFF.md Gotcha #1):**

- **Tier 1 (smoke, 3 tests):** `01-welcome.pty.test.mjs`, `02-run-picker.pty.test.mjs`, `03-ctrl-c-exits.pty.test.mjs`.
- **Tier 2 (validation, 20 tests):** `10-import-validation.validation.test.mjs`. Every `process.exit(1)` branch in `packages/experience-design-system-cli/src/import/command.ts`.
- **Tier 3a — headless (11 tests):** `20-import-headless.validation.test.mjs`. `--skip-apply`, `--print-prompt`, `--dry-run` (with/without deprecation notice), `--skip-analyze`, `--agent` routing, `--yes`, env-var credentials, `--verbose`, `--out`.
- **Tier 3b — PTY flag→state (7 tests):** `30-import-flag-to-state.pty.test.mjs`. `--project`, tokens-skip, `--auto-accept-scope`, `--no-push`, `--out-dir`, `--agent codex` routing, control test that scope-gate DOES render without `--auto-accept-scope`.
- **Tier 3b — AI-filter flags (2 tests):** `31-import-auto-filter.pty.test.mjs`. `--auto-filter` renders AI-filter banner + exclusions section; `--no-auto-filter` renders raw scope-gate with neither.
- **Tier 3b — selection & pipeline flags (6 tests):** `40-import-selection.validation.test.mjs`. `--deselect` (single + multi), `--select-all`, `--print + --out`, `--model haiku` reaches agent argv, `--agent codex` invokes only the codex binary.
- **Tier 3b — custom prompt paths (3 tests):** `50-import-custom-prompts.validation.test.mjs` + `51-import-generate-prompt.pty.test.mjs`.
- **Tier 3b — runs-based flags (4 tests):** `60-import-runs.pty.test.mjs`. `--push-from-run` (headless + PTY), `--modify` (PTY), run-not-found guard.
- **Tier 3b — `--modify` save modes (3 tests):** `61-import-modify-save-modes.pty.test.mjs`. Uses seeded pipeline.db to reach final-review with real generated components; `--overwrite` writes to `run.savePath` without a prompt; `--save-as-new` renders the "Save to:" prompt and does not silently save.
- **Tier 3b — `--force` staleness bypass (3 tests):** `62-import-force-staleness.pty.test.mjs`. Stale fingerprint triggers "Refusing to replay — STALE" without `--force`; `--force` proceeds to final-review.
- **Tier 3b — apply push against mock EMA (7 tests):** `70-apply-push.validation.test.mjs` + `helpers/mock-ema.mjs`.
- **Tier 3b — `--exclude-invalid` (2 tests):** `41-import-exclude-invalid.validation.test.mjs`. Uses the `react-invalid` fixture (two files exporting a component named `Duplicate` → DUPLICATE_COMPONENT_NAME) plus one valid component. Without the flag the select-agent gate fails; with the flag the invalid components are auto-dropped and the pipeline completes.
- **Tier 3b — push through the wizard against mock EMA (2 tests):** `71-import-push-through-wizard.pty.test.mjs`.
- **Tier 4 — welcome keystrokes (5 tests):** `01-welcome.pty.test.mjs`. Text entry rendered in "Project path:", backspace removes trailing chars, `q` and `esc` quit, empty Enter does not advance.
- **Tier 4 — run-picker keystrokes (5 tests):** `02-run-picker.pty.test.mjs`. `j` and `k` navigate/wrap, Enter opens the Push/Modify/Cancel sub-screen, Esc from the sub-screen returns to the list, `q` quits.
- **Tier 4 — credentials keystrokes (5 tests):** `04-credentials.pty.test.mjs`. Typing populates the active Space ID field, Tab cycles Space→Env→Token→Host, Enter with empty required fields surfaces the "All fields are required" inline error, backspace removes trailing chars, `q` quits.
- **Tier 4 — scope-gate keystrokes (6 tests):** appended to `30-import-flag-to-state.pty.test.mjs`. Uses `--no-auto-filter` so the AI section is empty; asserts `2/3 included` after `space`/`a`, `none included` after `A` (toggle all), `j` moves focus, `f` continues past the gate, `q` quits. Handoff table originally listed `[r]` (reject-all) — the current implementation aliases `r` to `a/space` (toggle focused) rather than a bulk-reject, so it's covered by the `a` test.
- **Tier 4 — FieldEditor keystrokes (3 tests):** appended to `61-import-modify-save-modes.pty.test.mjs`. Reaches the FieldEditor panel via `--modify` → final-review. Asserts the row-level mode-label ("↑↓/jk navigate rows..."), that `Tab` + `Enter` transitions the mode-label out of row-level, and that `Esc` returns to row-level.
- **Tier 4 — FieldEditor per-field keystrokes (5 tests):** `63-field-editor-per-field.pty.test.mjs`. Uses the new `pipeline-with-props.db` fixture variant so `loadCDFComponents` returns non-empty `$properties` for Button (disabled/boolean, label/string, variant/string). From the initial `disabled` row: Enter switches to field-level mode-label (`←→ cycle value`); right-arrow cycles the type picker (boolean → string wraparound); `j` walks type → category (bracketed `‹state›`); after two more `j`s, space toggles the required boolean glyph from `[ ]` to `[✓]`; after four `j`s, `Type to edit` renders and typed characters land in the bordered description input.
- **Tier 5 — analyze select-agent --show-rationale (3 tests):** `80-analyze-select-agent.validation.test.mjs`. Pure DB read of `raw_components.status` + `reject_reason` from the seeded session. Covers the human-readable table, `--json` machine-readable form, and unknown `--session` guard.
- **Tier 5 — analyze extract (4 tests):** `81-analyze-extract.validation.test.mjs`. `--project` reports the `session=<id>` stdout line + `Scanned N / Extracted M` stderr summary; `--dir <sub>` narrows the scan to a subdirectory (verified by absence of the sibling component's name); nonexistent `--dir` exits 1; `--resolve-unreachable` rejects invalid modes.
- **Tier 5 — generate components (4 tests):** `82-generate-components.validation.test.mjs`. `--dry-run` prints the prompt without hitting an agent binary (Button appears in the prompt for the seeded session); unknown `--agent` name rejected; unknown `--session` rejected; nonexistent `--generate-prompt-path` rejected.
- **Tier 5 — apply preview (3 tests):** `83-apply-preview.validation.test.mjs`. Non-TTY path emits the JSON preview summary against mock EMA (space/env context + component counts). 400 preview error surfaces at exit 1. `--cma-token` becomes `Authorization: Bearer <token>` on the outbound preview request.
- **Tier 5 — print components/tokens/validate (5 tests):** `84-print-commands.validation.test.mjs`. `print components --session --out` writes a CDF file containing Button/Card/Icon; unknown session exits 1 without writing; `print validate --components` accepts the fixture CDF, rejects a malformed one with exit 1, and errors when neither `--components` nor `--tokens` is passed.
- **Tier 5 — generate tokens (6 tests):** `85-generate-tokens.validation.test.mjs`. Sweeps four new fixtures (`fixtures/tokens/vars.scss`, `vars.css`, `vars.js`, `style-dictionary.json`) — each drives `--dry-run` and asserts a non-trivial prompt lands on stdout. Also covers the "no `--raw-tokens`" error and the nonexistent-file error.
- **Tier 5 — apply select non-interactive (5 tests):** `86-apply-select.validation.test.mjs`. `--select-all` pushes everything; `--select <substring>` narrows (selection is substring-based, `key.includes(pattern)`, not glob); breaking selection without `--force` exits 1 with no `/imports/apply` call; empty diff prints "up to date"; no non-interactive flag + non-TTY exits 1.
- **Tier 5 — analyze select non-interactive + test-mode (4 tests):** `87-analyze-select.validation.test.mjs`. `--select-all` completes non-interactively; `EDS_REVIEW_TEST_MODE=1` prints the session-directory contract without launching the TUI; unknown session rejected; TUI refuses to launch in non-TTY without a non-interactive flag. The interactive split-panel ORIGINAL/EDIT TUI is deferred to a follow-up.
- **Tier 5 — apply select interactive TUI (7 tests):** `88-apply-select-tui.pty.test.mjs`. Drives the `SelectView` (see `apply/tui/SelectView.tsx`) via real PTY against mock EMA with two "new" components (Button, Card). Covers: layout renders with both entities pre-selected + `[✓]` glyphs; `Space` toggles focused row (2 → 1 selected); `N` deselects all (2 → 0); `A` re-selects all after `N`; `↓` moves the `>` cursor to the second row; `Q` quits immediately with process.exit(0); `I` fires `/imports/apply` on the mock with a manifest that reflects the current selection (Button only, Card excluded).
- **Tier 6 — non-TTY degradation (3 tests):** `90-non-tty-degradation.validation.test.mjs`. `experiences import` with no bypass flags fails cleanly with the enumerated-bypass-list error message; `TERM=dumb` produces the same friendly error with no leaked ANSI escapes on either stream; `apply preview` under `TERM=dumb` still emits parseable JSON.
- **Tier 6 — PTY resize (1 test):** `91-pty-resize.pty.test.mjs`. From the scope-gate, shrink to 80×30 then grow to 240×70; the process must not exit and the "Components (3)" section + `[q]` legend must still render in the latest frame.
- **Tier 6 — Ctrl-C per wizard state (3 tests):** `92-ctrl-c-per-state.pty.test.mjs`. Extends `03-ctrl-c-exits` (which covers Welcome) with Design-tokens, scope-gate, and final-review (via `--modify` + seeded pipeline.db) — each must exit within a bounded window.
- **Tier 6 — Ctrl-C during in-flight push (1 test):** `93-ctrl-c-in-flight-push.pty.test.mjs`. Stalls the mock EMA's `/imports/apply` handler (accepts the socket, never responds); the wizard blocks awaiting completion; Ctrl-C must abort within 5s + no `/imports/apply/<opid>` completion poll fires after the abort.
- **Tier 6 — runs.json migration (3 tests):** `94-runs-migration.pty.test.mjs` + new `helpers/seed-runs-legacy.mjs`. v1 and v2 records surface in the run-picker (auto-migrated in memory by `runs/store.ts:migrateRecord`); unknown-version runs.json (v99) is skipped silently — wizard falls through to Welcome.
- **Tier 6 — malformed runs.json (3 tests):** `95-broken-runs-json.pty.test.mjs`. Non-JSON content, valid JSON with the wrong shape, and empty file all get skipped silently by `shouldShowRunPicker`; wizard advances to Welcome without an error banner.
- **Tier 6 — EDS_AGENT_BINARY_* overrides (2 tests):** `96-agent-binary-override.validation.test.mjs`. Nonexistent path surfaces the fallback-instructions error with exit 1; a stub that answers `auth status` OK but exits 1 on the generate call — plus `--no-cache` so the seeded pipeline doesn't short-circuit as "cached" — surfaces a per-component `Failed` summary.
- **Tier 4 — push confirm keystrokes (2 tests):** appended to `71-import-push-through-wizard.pty.test.mjs`. Reaches the push-confirm screen via `--modify --overwrite` → `[A]` → `[F]` → `y` → `[b]`. Asserts `[d]` flips the legend from "Show diff" to "Hide diff", and `[q]` cancels without appending a new `/imports/apply` request to the mock EMA request log. Note: the handoff mentions `y/n` on push-confirm; the actual step uses `Enter` to confirm (WizardPreviewStep.tsx L112-116) — `y/n` is the earlier "Save decisions and exit?" dialog, already covered. Drives `--modify` → final-review → `[A]` accept all → `[F]` finalize → `y` confirm → `[b]` save-and-push → `Enter` push, and asserts preview + apply requests land on the mock with the seeded space/environment path and `Authorization: Bearer` header from credentials.json. Also covers the breaking-changes gate: mock returns a `changed` component classified as `breaking` with non-zero impact; the wizard renders "Breaking changes will affect downstream entities. Press Enter to acknowledge and apply." and `apply` receives `acknowledgeBreakingChanges: true`.

**Fixtures:**

- `fixtures/projects/react-minimal/` — Button, Card, Icon.
- `fixtures/projects/react-invalid/` — DuplicateA, DuplicateB, Valid. Trips DUPLICATE_COMPONENT_NAME to exercise `--exclude-invalid`.
- `fixtures/components/react-minimal.components.json` — pre-baked CDF from a real wizard run.
- `fixtures/pipeline-state/pipeline.db` — pre-baked pipeline.db with 3 status='generated' components in session `true-creek-c44b`. Used by `--modify` tests via `EDS_PIPELINE_DB_PATH`.

**Helpers:**

- `tests/helpers/tmp-home.mjs` — per-test isolated `HOME`.
- `tests/helpers/run-cli.mjs` — headless CLI spawn.
- `tests/helpers/fixtures.mjs` — fixture paths.
- `tests/helpers/seed-runs.mjs` — write a `RunRecord` to `<home>/.config/experiences/runs.json`.
- `tests/helpers/seed-pipeline-db.mjs` — copy the pre-baked pipeline.db into `<home>/.contentful/experience-design-system-cli/pipeline.db`; exposes `SEEDED_SESSION_ID`.
- `tests/helpers/mock-ema.mjs` — in-process HTTP mock of Contentful EMA push endpoints. `.stub(method, urlPattern, handler)`, `.requests`.
- Stub agent (`src/stub-agent.mjs`) emits `classify_component` + `classify_prop` per detected prop; supports `STUB_ARGV_LOG` for asserting flag pass-through.

**Locked-in decisions:**

1. **Fixture strategy:** hand-crafted 3-component React library.
2. **Push mocking:** in-process HTTP server on 127.0.0.1 (not nock — CLI runs in a child process; nock can't cross the boundary).
3. **Parallelism:** `maxWorkers: 4`.
4. **Real agents:** stub by default; MCP server has a `stub_agents: false` opt-in.

**Wizard bugs found during test authoring:**

- `import/orchestrator.ts` forwards `--exclude-invalid` only on the `select-agent` branch (line 279). When the caller passes `--select-all` / `--select` / `--deselect`, the orchestrator instead builds an `analyze select --select-all` invocation and does NOT forward `--exclude-invalid`. So `import --select-all --exclude-invalid --skip-apply` always fails with "refusing --select-all without --exclude-invalid" even though `analyze select` itself supports the combination. Only the select-agent path (no manual select flags) actually honors `--exclude-invalid` end-to-end via `import`.

- `--select "Pattern"` is dropped by the wizard. `import/command.ts:467` threads `opts.select` into the headless `runPipeline` only; the WizardApp branch (lines 385-408) never consumes `opts.select`, so the wizard's scope-gate is not pre-populated. Same story for `--deselect` in the wizard. Headless `--select` / `--deselect` are covered in `40-import-selection.validation.test.mjs`; the wizard-side pre-selection is a wizard bug, not a testable behavior on this branch.

- `--no-live-preview` is dropped by the `--modify` entry (and by `--push-from-run`). `import/command.ts:398` sets `livePreview: opts.livePreview !== false` on the WizardApp props, but the `--modify` short-circuit at line 225 calls `modifyRun` → `launchModifyWizard` (see `runs/modify-launcher.ts`), which does NOT plumb `livePreview` through. So passing `--no-live-preview --modify` still fires the preview HTTP call at final-review entry. On the fresh-import path (no `--modify`, no `--push-from-run`), the flag IS wired through — but reaching final-review from a fresh wizard invocation requires driving the scope-gate + generate steps end-to-end, which is not currently supported by the harness. Verified by probing both modes against mock EMA on the `--modify` path: preview fires in both cases (1 call each).

**Remaining flags without dedicated coverage (pick up here):**

- `--no-live-preview` — **confirmed dropped on `--modify` path.** `launchModifyWizard` doesn't plumb `livePreview` through. See the wizard-bug entry below. On the fresh-import path the flag IS wired, but reaching final-review from a fresh wizard invocation requires driving scope-gate + generate end-to-end (out of harness scope today). Deferred.
- Wizard-side `--yes` on push-confirm — `import/command.ts` never plumbs `opts.yes` into WizardApp; on the TTY branch the flag only gates `isHeadless`, so `--yes --modify` in a real terminal still shows the push-confirm screen and requires Enter. Consider this a wizard gap (see the wizard-bugs section) rather than a test target.
- Interactive `--host` on `import` — for the `--modify` path the wizard reads host from credentials.json (via `readExperiencesCredentials` in `runs/replay-helpers.ts:198`), not from `opts.host`. The push-through-wizard test proves the wire-level routing works when the host is seeded via credentials. A dedicated test for the `--host` flag on a fresh (non-modify) import path still requires driving the full pipeline from scope-gate → generate → final-review, which is out of harness scope today.
- `--no-save` — same reason: no way to reach the wizard's push-confirm from a fresh invocation on this branch. The `--modify` path always saves (that's its whole point), so `--no-save` isn't meaningful there. Deferred until the harness can drive a fresh import through to push.
- `--on-conflict` write-path — only fires when the wizard's save step encounters a collision on disk. `--modify --overwrite` bypasses the conflict prompt entirely. Same blocker as `--no-save`.
- `--select "Button*"` / `--deselect "Icon*"` in PTY mode — **confirmed dropped by the wizard.** `import/command.ts:467` threads `opts.select` into the headless `runPipeline` only; WizardApp props never consume it. Documented as a wizard bug; no PTY test written. Headless coverage remains in `40-import-selection.validation.test.mjs`.
- `--viewports <path>` — passed to `apply push`; needs a viewports fixture and a push test that asserts they appear in the manifest.
- `--host` on `import` (as opposed to `apply push`) — the flag reaches `WizardApp` via a prop; assert via banner or wizard state.

Recommended sequencing for the next agent:
1. Push-through-wizard finalize → save/push chooser → push. Verify the exact keystrokes with a hand-driven probe; then wrap in tests using mock-ema + seed-pipeline-db + seed-runs. This unlocks `--yes` (interactive), `--no-save`, `--on-conflict` writes, breaking-changes gate, `--host` on import — all in one test file.
2. `--exclude-invalid` fixture that actually triggers a validation error. Look at `analyze/extract/validate.ts` for the EMPTY_PROP_NAME / EMPTY_COMPONENT_NAME / PROP_SLOT_NAME_COLLISION triggers.
3. `--no-live-preview` investigation — verify current wizard behavior; if it's wired but my probe missed the trigger, add the test; if it's a wizard bug, file it.

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
| 30 | ✅ | `import --exclude-invalid` | select-agent drops invalid, pipeline completes | `41-import-exclude-invalid.validation.test.mjs` (headless, select-agent path) |
| 31 | ✅ | `import --auto-filter` | shows filter progress | `31-import-auto-filter.pty.test.mjs` |
| 32 | ✅ | `import --no-auto-filter` | jumps to manual scope-gate | `31-import-auto-filter.pty.test.mjs` |
| 33 | ⏭️ | `import --no-live-preview` | final review, no auto-preview | **wizard bug:** flag dropped on `--modify` / `--push-from-run` paths (see "Wizard bugs" below); fresh-import path can't reach final-review from harness today |
| 34 | ⏭️ | `import --yes` | skips push confirmation | **wizard gap:** `opts.yes` never reaches WizardApp; only gates `isHeadless`. |
| 35 | ✅ | `import --force` | bypasses staleness check | `62-import-force-staleness.pty.test.mjs` |
| 36 | ✅ | `import --verbose` | shows full progress | Tier 3a |
| 37 | ✅ | `import --print` | writes components.json | `40-import-selection.validation.test.mjs` |
| 38 | ✅ | `import --out /tmp/xyz` | uses custom out dir | Tier 3a |
| 39 | ✅ | `import --out-dir /tmp/xyz` | bypasses inline save prompt | `30-import-flag-to-state.pty.test.mjs` |
| 40 | ⏭️ | `import --on-conflict overwrite` | replaces existing file | needs push-through-wizard flow (headless --print ignores it) |
| 41 | ⏭️ | `import --on-conflict skip` | writes to timestamped subdir | same |
| 42 | ⏭️ | `import --on-conflict fail` | exits non-zero | same |
| 43 | ✅ | `import --select-prompt-path /path.md` | banner names custom prompt | `50-import-custom-prompts.validation.test.mjs` |
| 44 | ✅ | `import --generate-prompt-path /path.md` | banner names custom prompt | `51-import-generate-prompt.pty.test.mjs` |
| 45 | ✅ (partial) | `import --host https://api.flinkly.com` | staging routing | `71-import-push-through-wizard.pty.test.mjs` seeds `mock.host` via credentials.json and asserts all API calls hit that host. Direct `--host` flag on a fresh import still deferred. |
| 46 |  | `import --viewports /path.json` | passes viewports to push | needs viewports fixture + push |
| 47 | ✅ | `import --push-from-run <valid>` | jumps to push directly (creds prompt) | `60-import-runs.pty.test.mjs` |
| 48 | ✅ | `import --modify <valid>` | opens at final-review (load state) | `60-import-runs.pty.test.mjs` |
| 49 | ✅ | `import --modify X --overwrite` | saves to recorded savePath | `61-import-modify-save-modes.pty.test.mjs` |
| 50 | ✅ | `import --modify X --save-as-new` | prompts for new path | `61-import-modify-save-modes.pty.test.mjs` |
| 51 | ✅ | `import --agent codex` | routes agent-runner via env override | `30-…` + `40-…` |
| 52 | ✅ | `import --model haiku` | passes model to agent | `40-import-selection.validation.test.mjs` |
| 53 | ⏭️ | `import --select "Button*"` | pre-selects matching | **wizard bug:** flag dropped by WizardApp (see "Wizard bugs" below). Headless coverage in `40-…`. |
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

1. **✅ Done — CI regression net + full flag coverage bar 4 flags:** Tier 1 (3) + Tier 2 (20) + Tier 3a headless (11) + Tier 3b PTY flag→state (7 + 2 AI-filter) + selection & pipeline (6) + custom prompts (3) + runs-based (4) + modify save-modes (3) + force staleness (3) + apply push against mock EMA (7) = **69 tests**.
2. **⏭️ Next — 4 remaining Tier 3 flags:** `--no-live-preview`, `--exclude-invalid`, push-through-wizard bundle (`--yes`/`--no-save`/`--on-conflict` writes/`--host` on `import`/breaking-changes gate), and `--select "Button*"` (probably a wizard bug, not a test).
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

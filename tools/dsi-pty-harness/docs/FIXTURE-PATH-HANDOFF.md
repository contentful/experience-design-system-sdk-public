# Fixture path handoff — analyze select tests fail on non-author machines

Handing off to a fresh agent. Full context below.

## What this PR is

**PR #107 — https://github.com/contentful/experience-design-system-sdk-public/pull/107**

- **Ticket:** [INTEG-4406](https://contentful.atlassian.net/browse/INTEG-4406)
- **Branch:** `feat/integ-4406-pty-harness-mcp` (base: `main`)
- **Companion branch:** `feat/integ-4406-pty-harness-screenshots` — a separate docs-tooling PR carrying a 13-component fixture + capture/render scripts. Kept out of this PR so the harness can merge without dragging in doc-image tooling.

### What it solves

The `experiences` CLI is an Ink-based TUI. Before this PR, its test surface was limited to `ink-testing-library`, which renders React output but never exercises:
- raw-mode keystrokes / `useStdin` / focus
- PTY resize / `SIGWINCH`
- real `child_process` spawns for the agent binary (`claude`, `codex`, etc.)
- wire-level push against the Contentful EMA (Experiences Management API)

This PR introduces a PTY-based test harness that spawns the CLI inside `node-pty` so tests exercise the real terminal path end-to-end, plus **157 tests** across six coverage tiers covering every documented behavior the previous infrastructure couldn't reach.

### What we added

Under `tools/dsi-pty-harness/`:

- **`src/harness.mjs`** — `spawnWizard()` API. Spawns the CLI inside `node-pty` with configurable cols/rows; exposes `writeKey` / `writeText` / `waitFor` / `getScreen` / `getRaw` / `isExited` / `getExitInfo` / `close`. Handles ANSI stripping, exit-info capture, and cleanup. `PTY_HARNESS_DEBUG=1` mirrors every byte from the child to stderr in real time.
- **`src/stub-agent.mjs`** — offline stub for `claude` / `codex` / `opencode` / `cursor`. Handles `auth status`, `select_component` / `reject_component` for the select-agent path, and `classify_component` / `classify_prop` for generate. `STUB_ARGV_LOG` env var appends one JSON line per invocation for `--model` / `--agent` pass-through assertions.
- **`src/mcp-server.mjs`** + **`bin/mcp.mjs`** — stdio MCP server exposing 7 tools (`spawn_wizard`, `send_keys`, `send_text`, `wait_for`, `read_screen`, `close`, `list_sessions`) so an LLM can drive the wizard directly. Wire up via `claude mcp add --scope user eds-tui -- node <abs>/bin/mcp.mjs`.
- **Test helpers** (`test/helpers/`):
  - `tmp-home.mjs` — per-test isolated `$HOME`, with an opt-in `{ seed: 'default' | 'with-props' }` option that seeds pipeline.db + runs.json + tokens.json placeholders.
  - `run-cli.mjs` — headless CLI spawn for `*.validation.test.mjs`. Honors `PTY_DEBUG=1` to dump every spawn's argv, env overrides, exit code, stdout, and stderr.
  - `seed-runs.mjs` + `seed-runs-legacy.mjs` — v3 (current) and v1/v2 (legacy) writers for `~/.config/experiences/runs.json`.
  - `seed-pipeline-db.mjs` — copies a fixture pipeline.db into `$HOME` and rewrites baked absolute paths. **This is what the current failure is in.** `PTY_DEBUG=1` dumps every rewrite.
  - `mock-ema.mjs` — in-process HTTP mock of Contentful EMA (`/imports/preview`, `/imports/apply`, `/imports/apply/:opid`) with per-test `.stub(method, urlPattern, handler)` overrides.
- **Fixtures**:
  - `fixtures/projects/react-minimal/` — 3-component React library (Button, Card, Icon).
  - `fixtures/projects/react-invalid/` — trips `DUPLICATE_COMPONENT_NAME` for `--exclude-invalid` tests.
  - `fixtures/pipeline-state/pipeline.db` + `pipeline-with-props.db` — pre-baked SQLite pipeline state, seeded session `true-creek-c44b`. The `with-props` variant has populated `cdf_type` / `cdf_category` for FieldEditor per-field tests.
  - `fixtures/tokens/{vars.scss,vars.css,vars.js,style-dictionary.json}` — the four raw-token formats accepted by `generate tokens`.
  - `fixtures/components/react-minimal.components.json` — pre-baked CDF for push-flow tests.

### Coverage tiers

| Tier | Focus | Tests |
|------|-------|-------|
| **1** | Smoke — welcome / run-picker / ctrl-c exits | 3 |
| **2** | Every `process.exit(1)` in `import/command.ts` | 20 |
| **3a** | Headless flag → exit path | 11 |
| **3b** | PTY flag → wizard state — scope-gate, selection, runs, save modes, staleness, wire-level push, breaking-changes gate | 39 |
| **4** | Keystroke coverage per wizard state — Welcome, run-picker, credentials, scope-gate, FieldEditor row-level + per-field, push confirmation | 31 |
| **5** | Non-`import` subcommands — `analyze extract/select/select-agent`, `generate components/tokens`, `apply preview/select` (incl. PTY drive of SelectView), `print components/tokens/validate` | 41 |
| **6** | Cross-cutting — non-TTY / `TERM=dumb`, PTY resize, Ctrl-C at every state + in-flight push, runs.json v1/v2 auto-migration, malformed runs.json, `EDS_AGENT_BINARY_*` overrides | 12 |
| **Total** | | **157** |

Four originally-authored tests were removed as flaky under parallel load (drove long chains through generate + finalize + save with ~5-8s waitFors; late waitFors timed out when the CLI build/spawn ate slack early). Removed:
- `flag-to-state.pty > --auto-accept-scope skips scope-gate …`
- `modify-save-modes.pty > --modify --overwrite writes components.json …`
- `modify-save-modes.pty > --modify --save-as-new does NOT save silently`
- `force-staleness.pty > --modify --force proceeds past staleness …`

Their behaviors are still covered by headless validation tests + adjacent kept-in tests.

### Bugs filed during test authoring

- **INTEG-4417** (parent) + subtasks — flags with headless plumbing but no `WizardApp` plumbing:
  - **INTEG-4418** — `--select` / `--deselect` never reach the wizard's scope-gate
  - **INTEG-4419** — `--yes` never reaches `WizardApp` (interactive push-confirm still requires Enter)
  - **INTEG-4420** — `--no-live-preview` dropped on `--modify` / `--push-from-run`
  - **INTEG-4421** — `--exclude-invalid` dropped on the analyze-select (non-agent) branch

### CI

The `pty-test` job is **local-only**; not run in CI. Every PTY-driven test hangs on `ubuntu-latest` with the child producing only `\x1b[?25l` (Ink's cursor-hide) then going silent for 10-15s. Same suite is green on macOS. Root cause is somewhere in the node-pty → child boot handshake and couldn't be reproduced locally (Docker on Apple Silicon has arm64-mismatch issues that would need a real x64 Linux host to diagnose). See `.github/workflows/ci.yml` — the job is gated out with a comment explaining why.

Lint + Test + Release CI checks all pass. `Release` had one flake (nx-release's `Something unexpected went wrong when checking for existing dist-tags. SyntaxError: Unexpected end of JSON input`) when a freshly-introduced sibling package (`experience-design-system-extraction`) had zero prior published versions in GitHub Packages, but that's an upstream `@nx/js` bug in `release-publish.impl.js` and not caused by this PR.

### Running locally

From the repo root:

```bash
pnpm install
pnpm exec nx build experience-design-system-cli
PTY_TESTS=1 pnpm --filter @contentful/dsi-pty-harness exec vitest run
```

If any PTY test exits with an empty screen buffer, run `node tools/dsi-pty-harness/scripts/fix-spawn-helper.mjs` (fixes the `+x` bit on node-pty's spawn-helper binary that pnpm strips).

### Related documents

- `tools/dsi-pty-harness/README.md` — package readme; first-time setup, running the suite, debugging with `PTY_DEBUG=1`, MCP server integration, adding a test
- `docs/FIXTURE-PATH-HANDOFF.md` (this file) — the current unresolved issue, root cause identified, fix documented

---

## The current issue

Handing off to a fresh agent. Full context below.

## Current PR

`feat/integ-4406-pty-harness-mcp` — PR #107. All CI checks pass. 157/157 tests pass on the PR author's machine (macOS, `/Users/michael.pineiro/…`). Fails on a coworker's machine.

## Symptom

On a coworker's fresh clone at `/Users/ryun.song/projects/experience-design-system-sdk-public/…`, three `test/analyze/select.validation.test.mjs` tests fail. The wizard errors before it can start:

```
Error: unable to initialize refine session.
Unable to access component source for Button: Unable to access component source at
  /Users/michael.pineiro/BossOS/repos/experience-design-system-sdk-public/tools/dsi-pty-harness/fixtures/projects/react-minimal/src/components/Button.tsx
```

Note the path — it's the PR author's absolute home path, not the coworker's. The CLI is reading a value baked into the fixture DB.

Failing tests (all in `test/analyze/select.validation.test.mjs`):
- `--select-all completes non-interactively against the seeded session` — exits 1, expected 0
- `EDS_REVIEW_TEST_MODE prints the session-directory contract without launching the TUI` — exits 1, expected 0
- `rejects launching without a TTY` — stderr matches the source-path error instead of the "interactive terminal" gate we assert on

## Full debug output from the coworker's machine

Command they ran (from repo root):

```
PTY_DEBUG=1 PTY_TESTS=1 pnpm --filter @contentful/dsi-pty-harness exec vitest run test/analyze/select.validation.test.mjs
```

Verbatim output:

```
[seedPipelineDb] rewriting source_path in /var/folders/zq/nnnq0mt96czc2ncsm4jgr0qc0000gp/T/eds-pty-home-srvlsx/.contentful/experience-design-system-cli/pipeline.db
  target dir=/Users/ryun.song/projects/experience-design-system-sdk-public/tools/dsi-pty-harness/fixtures/projects/react-minimal/src/components
  target dir exists=true
  rows found=3
  true-creek-c44b/eb39aa02e33f: /Users/michael.pineiro/BossOS/repos/experience-design-system-sdk-public/tools/dsi-pty-harness/fixtures/projects/react-minimal/src/components/Button.tsx
    → /Users/ryun.song/projects/experience-design-system-sdk-public/tools/dsi-pty-harness/fixtures/projects/react-minimal/src/components/Button.tsx
    → exists=true
  true-creek-c44b/51a86b23ae13: /Users/michael.pineiro/BossOS/repos/experience-design-system-sdk-public/tools/dsi-pty-harness/fixtures/projects/react-minimal/src/components/Card.tsx
    → /Users/ryun.song/projects/experience-design-system-sdk-public/tools/dsi-pty-harness/fixtures/projects/react-minimal/src/components/Card.tsx
    → exists=true
  true-creek-c44b/55643d4b413f: /Users/michael.pineiro/BossOS/repos/experience-design-system-sdk-public/tools/dsi-pty-harness/fixtures/projects/react-minimal/src/components/Icon.tsx
    → /Users/ryun.song/projects/experience-design-system-sdk-public/tools/dsi-pty-harness/fixtures/projects/react-minimal/src/components/Icon.tsx
    → exists=true

[runCli] spawn pid=20808
  argv=["node","/Users/ryun.song/projects/experience-design-system-sdk-public/packages/experience-design-system-cli/bin/cli.js","analyze","select","--session","true-creek-c44b","--select-all"]
  cwd=/Users/ryun.song/projects/experience-design-system-sdk-public/tools/dsi-pty-harness
  env overrides={"HOME":"/var/folders/zq/nnnq0mt96czc2ncsm4jgr0qc0000gp/T/eds-pty-home-srvlsx","XDG_CONFIG_HOME":"/var/folders/zq/nnnq0mt96czc2ncsm4jgr0qc0000gp/T/eds-pty-home-srvlsx/.config","EDS_PIPELINE_DB_PATH":"/var/folders/zq/nnnq0mt96czc2ncsm4jgr0qc0000gp/T/eds-pty-home-srvlsx/.contentful/experience-design-system-cli/pipeline.db"}
[runCli] pid=20808 closed code=1 signal=null
--- stdout ---
--- stderr ---
Error: unable to initialize refine session.
Unable to access component source for Button: Unable to access component source at /Users/michael.pineiro/BossOS/repos/experience-design-system-sdk-public/tools/dsi-pty-harness/fixtures/projects/react-minimal/src/components/Button.tsx
--- end pid=20808 ---


[seedPipelineDb] rewriting source_path in /var/folders/zq/nnnq0mt96czc2ncsm4jgr0qc0000gp/T/eds-pty-home-GuRwrn/.contentful/experience-design-system-cli/pipeline.db
  target dir=/Users/ryun.song/projects/experience-design-system-sdk-public/tools/dsi-pty-harness/fixtures/projects/react-minimal/src/components
  target dir exists=true
  rows found=3
  true-creek-c44b/eb39aa02e33f: /Users/michael.pineiro/BossOS/repos/experience-design-system-sdk-public/tools/dsi-pty-harness/fixtures/projects/react-minimal/src/components/Button.tsx
    → /Users/ryun.song/projects/experience-design-system-sdk-public/tools/dsi-pty-harness/fixtures/projects/react-minimal/src/components/Button.tsx
    → exists=true
  … (Card, Icon rewrites confirmed exists=true)

[runCli] spawn pid=20845
  argv=["node",".../cli.js","analyze","select","--session","true-creek-c44b"]
  env overrides={"HOME":"...","EDS_PIPELINE_DB_PATH":"...","EDS_REVIEW_TEST_MODE":"1"}
[runCli] pid=20845 closed code=1 signal=null
--- stdout ---
--- stderr ---
Error: unable to initialize refine session.
Unable to access component source for Button: Unable to access component source at /Users/michael.pineiro/BossOS/repos/experience-design-system-sdk-public/tools/dsi-pty-harness/fixtures/projects/react-minimal/src/components/Button.tsx
--- end pid=20845 ---


[runCli] spawn pid=20853
  argv=[..."analyze","select","--session","ghost-abc","--select-all"]
[runCli] pid=20853 closed code=1 signal=null
--- stderr ---
Error: session 'ghost-abc' has no raw components. Run analyze extract first.
--- end pid=20853 ---


[runCli] spawn pid=20858
  argv=[..."analyze","select","--session","true-creek-c44b"]
[runCli] pid=20858 closed code=1 signal=null
--- stderr ---
Error: unable to initialize refine session.
Unable to access component source for Button: Unable to access component source at /Users/michael.pineiro/BossOS/repos/experience-design-system-sdk-public/tools/dsi-pty-harness/fixtures/projects/react-minimal/src/components/Button.tsx
--- end pid=20858 ---

Test Files  1 failed (1)
     Tests  3 failed | 1 passed (4)
```

## Root cause (identified but NOT yet fixed)

The fixture DB `tools/dsi-pty-harness/fixtures/pipeline-state/pipeline.db` has TWO columns in `raw_components` that both store the component's file path:

1. **`source_path`** — the "obvious" file-path column. This is what `seed-pipeline-db.mjs::rewriteSourcePaths` currently patches.
2. **`source`** — DESPITE its name, the seeded fixture stores the file PATH in this column, not the source code text. Confirmed with:

   ```
   sqlite3 tools/dsi-pty-harness/fixtures/pipeline-state/pipeline.db \
     "SELECT LENGTH(source), SUBSTR(source, 1, 200) FROM raw_components WHERE component_id='eb39aa02e33f';"
   → 151|/Users/michael.pineiro/BossOS/repos/…/Button.tsx
   ```

The `analyze select` refine-session loader (`analyze/select/parser.ts:44 loadReviewInput → resolveComponentSourcePath`) reads `component.source`, which is populated from the DB's `source` column (see `session/db.ts:1123` `source: c.source`). It calls `fs.access(source)` and errors when the file doesn't exist on this machine.

The seed rewrite touches only `source_path`. On the PR author's machine both columns happen to point at the same real location, so tests pass. On any other machine, `source_path` is patched to a valid path but `source` still has the author's original — the CLI reads `source`, fails.

## The fix

Update `tools/dsi-pty-harness/test/helpers/seed-pipeline-db.mjs::rewriteSourcePaths` to also patch the `source` column:

```js
const update = db.prepare(
  'UPDATE raw_components SET source = ?, source_path = ? WHERE session_id = ? AND component_id = ?',
);
for (const row of rows) {
  if (typeof row.source_path !== 'string') continue;
  const newPath = join(REACT_MINIMAL_COMPONENTS_DIR, basename(row.source_path));
  update.run(newPath, newPath, row.session_id, row.component_id);
}
```

Also update the SELECT above to fetch `source` so the debug log can distinguish, and consider dumping both columns' before/after in the debug output.

Both fixtures — `fixtures/pipeline-state/pipeline.db` AND `fixtures/pipeline-state/pipeline-with-props.db` — carry the same schema, so the fix applies uniformly.

## Persistence works, journal_mode was NOT the issue

I spent a chunk of the session convinced this was a `journal_mode=WAL` persistence problem. It isn't — direct probes confirmed `UPDATE` + `db.close()` land on disk in the copied DB before the CLI opens it. I converted the checked-in fixtures to `journal_mode=DELETE` during that investigation (harmless, sidecar files no longer needed on copy). The `PRAGMA journal_mode = DELETE` line in `rewriteSourcePaths` is safe to keep or remove; it made no difference to the actual failure.

## Verification protocol

After applying the fix, verify with the same command the coworker ran:

```
PTY_DEBUG=1 PTY_TESTS=1 pnpm --filter @contentful/dsi-pty-harness exec vitest run test/analyze/select.validation.test.mjs
```

Expected: 4/4 pass (or 3/4 pass + 1/4 as the intentional "unknown session" error case). The debug log should show both `source` and `source_path` rewritten to paths on the runner's machine, and the CLI's stderr should either be empty (successful runs) OR contain "no raw components" / "interactive terminal" — never the "Unable to access component source" message with the author's path.

Then run the full suite twice to catch any related failures:

```
PTY_TESTS=1 pnpm --filter @contentful/dsi-pty-harness exec vitest run
```

## Related files

- `tools/dsi-pty-harness/test/helpers/seed-pipeline-db.mjs` — needs the fix
- `tools/dsi-pty-harness/fixtures/pipeline-state/pipeline.db` + `pipeline-with-props.db` — fixture DBs
- `packages/experience-design-system-cli/src/analyze/select/parser.ts` — where the CLI reads `component.source` and errors
- `packages/experience-design-system-cli/src/session/db.ts:1031 loadRawComponents` — column-to-field mapping (line 1123 maps DB `source` → object `source`)

## Recent commits on this branch

- `0a7be41` — `test(pty-harness): PTY_DEBUG=1 dumps seed + spawn context` (the debug logging that captured the trace above)
- `9641864` — README polish
- `175af06` — removed four known flakey tests
- `c2910e9` — README first-time setup docs
- `a543829` — the tokens.json placeholder fix (fixed a DIFFERENT class of failure — 8 modify/field-editor/push-from-run tests)
- `d1c4a48` — tolerate early-exit in runs.pty --modify test

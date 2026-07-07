# PTY harness handoff — INTEG-4406

You're picking up the PTY test harness for the `experiences` CLI. This doc is your entry point.

**Read order:**
1. This file (orient + gotchas)
2. `docs/test-coverage-plan.md` (row-by-row flag matrix + full history)
3. `tools/dsi-pty-harness/README.md` (usage)
4. One existing test file (e.g. `tests/61-import-modify-save-modes.pty.test.mjs`) to see the pattern

---

## Where things stand

**Branch:** `feat/integ-4406-pty-harness-mcp` (base: `feat/dsi-tui-wizard-mega`)

**Test count:** 73/73 green.

**Companion branch:** `feat/integ-4406-pty-harness-screenshots` — squashed docs-tooling PR (13-component fixture + capture/render scripts). Kept separate so the harness branch can merge without dragging in doc-image tooling.

**Coverage complete:**

- Tier 1 (smoke) — 3 tests
- Tier 2 (validation branches, every `process.exit(1)` in `import/command.ts`) — 20 tests
- Tier 3a (headless flag → exit path) — 11 tests
- Tier 3b (PTY flag → wizard state, plus selection / custom prompts / runs / modify save modes / force staleness / apply push against mock EMA) — 39 tests

**Coverage remaining:** Tiers 4, 5, 6. See the sections below.

**Filed bugs discovered during test authoring:** INTEG-4417 (parent) and its four subtasks — flags with headless plumbing but no WizardApp plumbing (`--select`/`--deselect`, `--yes`, `--no-live-preview`, `--exclude-invalid` orchestrator branch). Documented in `docs/test-coverage-plan.md` under "Wizard bugs found during test authoring".

---

## How the harness works

The `experiences` CLI is an Ink-based TUI. `ink-testing-library` renders the React output but never exercises raw-mode keystrokes, `useStdin`, focus, PTY resize, or real `child_process` spawns for the agent binary. This harness spawns the CLI inside `node-pty` so tests exercise the real terminal path.

### Two test flavors

Both live under `tests/`, both run when `PTY_TESTS=1` is set. Split by suffix:

| Suffix | Runner | When to use |
|---|---|---|
| `*.validation.test.mjs` | Headless spawn via `runCli` | Testing flags that route to `runPipeline` (headless mode) or non-TTY-required behaviors. No terminal driven. Fast (~500ms/test). |
| `*.pty.test.mjs` | Real PTY via `spawnWizard` | Testing wizard states, keystroke handling, focus, live rendering. Slow (~1-3s/test). |

**Rule of thumb:** if the flag ends up on the headless `runPipeline` path (`import/command.ts:456-482`), use validation. If it reaches `WizardApp` props (`import/command.ts:385-408`), use PTY.

### Directory layout

```
tools/dsi-pty-harness/
├── bin/mcp.mjs                          # stdio MCP server (unused by tests)
├── src/
│   ├── harness.mjs                      # spawnWizard() — main API
│   ├── mcp-server.mjs                   # MCP server impl (LLM-driven use)
│   └── stub-agent.mjs                   # fake `claude`/`codex`/etc. binary
├── fixtures/
│   ├── projects/react-minimal/          # 3-component React lib (Button/Card/Icon)
│   ├── projects/react-invalid/          # Component name collision → validation error
│   ├── components/                      # Pre-baked components.json
│   └── pipeline-state/pipeline.db       # Pre-baked SQLite pipeline state
├── tests/
│   ├── helpers/
│   │   ├── tmp-home.mjs                 # per-test isolated HOME
│   │   ├── run-cli.mjs                  # headless spawn
│   │   ├── fixtures.mjs                 # fixture path constants
│   │   ├── seed-runs.mjs                # write runs.json into a tmp HOME
│   │   ├── seed-pipeline-db.mjs         # copy pipeline.db fixture into a tmp HOME
│   │   └── mock-ema.mjs                 # in-process HTTP mock of Contentful EMA
│   └── *.{pty,validation}.test.mjs      # test files
├── docs/
│   ├── HANDOFF.md                       # this file
│   └── test-coverage-plan.md            # row-by-row flag matrix
├── scripts/
│   ├── fix-spawn-helper.mjs             # postinstall: chmod +x node-pty's spawn-helper
│   └── (screenshot scripts live on the screenshots branch)
├── vitest.config.ts                     # gate: PTY_TESTS=1; maxWorkers=4
└── project.json                         # nx target: `pty-test`
```

### spawnWizard API

```js
import { spawnWizard } from '../src/harness.mjs';

const w = await spawnWizard(argv, {
  env: {...process.env, ...customEnv},   // process.env baseline + overrides
  cwd: process.cwd(),                    // optional
  cols: 200, rows: 60,                   // PTY dimensions
  stubAgents: true,                      // default: shadow every agent binary
});

// Drive:
w.writeKey('enter' | 'tab' | 'space' | 'esc' | 'up' | 'down' | 'left' | 'right' | 'ctrl-c' | 'ctrl-d' | 'ctrl-s' | 'a-z');
w.writeText('literal string');

// Observe:
await w.waitFor(/regex/ | 'string', { timeout: 5000, interval: 50 });
w.getScreen();  // ANSI-stripped, appended over time
w.getRaw();     // raw buffer WITH ANSI codes
w.isExited();
w.getExitInfo();

// Cleanup — always in a finally block:
await w.close();
```

`stubAgentEnv()` from the same module sets `EDS_AGENT_BINARY_*` to point at the local stub. Applied automatically unless `stubAgents: false`.

### The stub agent (`src/stub-agent.mjs`)

Intercepted via `EDS_AGENT_BINARY_CLAUDE=/path/to/stub-agent.mjs` (production feature in `agent-runner.ts:resolveBinary`). The stub:

1. Handles `auth status` — returns `{loggedIn: true}` so `checkAgentAuth()` passes.
2. Detects generate vs select-agent prompts (looks for `select_component` in the prompt text).
3. For **generate**: emits `classify_component` + one `classify_prop` per detected prop.
4. For **select-agent**: enumerates components from `"path": "src/.../<Name>.tsx"` JSON fields in the batch prompt, emits one `select_component` or `reject_component` per name.
5. Supports `STUB_ARGV_LOG=/path/to/file` — appends one JSON line per invocation. Lets tests assert on `--model` or `--agent` pass-through.

**Important:** the stub is not on this branch's `stub-agent.mjs` in the "smarter" form (that's on the screenshots branch). If you rebase from the screenshots branch or land its follow-up PR first, you get:
- Batch enumeration for `select-agent`
- `Modal`/`Divider` reject list (doc-image concern only; can be dropped)

For Tier 4/5/6 work on the harness branch, the current stub is sufficient — but if a select-agent test needs the wizard's scope-gate to show BOTH exclusions and inclusions, the smarter version is a small port.

### Helpers, one-liner descriptions

- **`makeTmpHome()`** — creates a fresh `HOME=<tmp>` for one test, returns `{home, env, cleanup}`. Always `cleanup()` in a `finally`.
- **`runCli(args, {env, timeoutMs})`** — spawns the CLI headlessly, returns `{stdout, stderr, code, signal}`. Uses `stdio: ['ignore', 'pipe', 'pipe']` so `process.stdout.isTTY` is false.
- **`seedRuns(home, [{id, extractSessionId, generateSessionId, savePath, ...}])`** — writes `<home>/.config/experiences/runs.json`. Partial `RunRecord`s auto-filled with defaults.
- **`seedPipelineDb(home)`** — copies `fixtures/pipeline-state/pipeline.db` into `<home>/.contentful/experience-design-system-cli/pipeline.db`. Returns `{dbPath, sessionId}`. `SEEDED_SESSION_ID` constant is exported (`true-creek-c44b`) — the session in the fixture DB whose `raw_components` have `status='generated'`.
- **`startMockEma()`** — in-process HTTP server on 127.0.0.1 with the Contentful EMA push endpoints stubbed. Returns `{host, requests, stub(method, urlPattern, handler), close()}`. Handlers can override any endpoint per test.

### `EDS_AGENT_BINARY_*` and `EDS_PIPELINE_DB_PATH`

Two production env-override hooks that make the whole harness possible:

- `EDS_AGENT_BINARY_CLAUDE=/path` → `resolveBinary('claude')` returns the override. Same for `_CODEX`, `_OPENCODE`, `_CURSOR`. Lands in `packages/experience-design-system-cli/src/generate/agent-runner.ts`.
- `EDS_PIPELINE_DB_PATH=/path/to/pipeline.db` → CLI opens that DB instead of `~/.contentful/experience-design-system-cli/pipeline.db`. Lands in `packages/experience-design-system-cli/src/session/db.ts`.

Both are legit user-facing features. The harness relies heavily on them.

---

## Running the suite

```bash
# From the repo root
PTY_TESTS=1 pnpm --filter @contentful/dsi-pty-harness exec vitest run

# Single test file
PTY_TESTS=1 pnpm --filter @contentful/dsi-pty-harness exec vitest run tests/30-import-flag-to-state.pty.test.mjs

# Watch mode (dev loop)
PTY_TESTS=1 pnpm --filter @contentful/dsi-pty-harness exec vitest --reporter=verbose

# Via nx (also builds CLI first — slower)
PTY_TESTS=1 pnpm exec nx run dsi-pty-harness:pty-test
```

**Without `PTY_TESTS=1`** the suite matches zero files and passes trivially. This is intentional — the tests spawn real processes and are opt-in.

**First run on a fresh clone:** `pnpm install` — the postinstall script `scripts/fix-spawn-helper.mjs` restores the `+x` bit on `node-pty`'s `spawn-helper` binary, which pnpm's install strips. If you see `posix_spawnp failed`, run that script manually.

---

## Gotchas that will bite you

### 1. Parallel test flakes (`maxWorkers: 4`)

`vitest.config.ts` caps concurrency at 4. Two tests still occasionally flake under parallel load:
- `30-import-flag-to-state.pty.test.mjs` — `--auto-accept-scope` assertion
- `61-import-modify-save-modes.pty.test.mjs` — `--modify --save-as-new`

Both pass in isolation. Retry the whole suite — the flakes are timing-sensitive, not real regressions. If you're touching those tests, run 3 times consecutively before declaring stable.

### 2. Ink's append-only buffer

`w.getScreen()` returns everything Ink has ever rendered, ANSI-stripped. Frames stack — every re-render adds another copy of the current view. Assertions must either:

- Match on the LAST occurrence of a marker (default `.includes()` finds the first)
- Search `w.getRaw()` for a specific state that appeared briefly and got overwritten (e.g. "Auto-accepting 3 components" is a flash message)
- Use a distinctive terminal state that only appears once ("Save decisions and exit?", "Design tokens")

Pattern for "last frame":

```js
const screen = w.getScreen();
const marker = 'Some section header';
const lastIdx = screen.lastIndexOf(marker);
const lastFrame = screen.slice(lastIdx);
expect(lastFrame).toMatch(/something/);
```

### 3. The auto-rebuild banner

`bin/cli.js` auto-rebuilds when `packages/experience-design-system-cli/src/` is newer than `dist/`. It prints `⚙ Source changed — rebuilding...` to stderr and blocks for ~5s. If you're editing CLI source between test runs, either commit + build once, or filter this banner from captured output.

### 4. Working tree drift between branch switches

Multiple agents work on this repo. If you find yourself on `main` or `chore/prettier-mega-lint-fix` when you didn't switch, that's another agent hopping branches. Always:

```bash
git branch --show-current   # verify before every commit
git checkout feat/integ-4406-pty-harness-mcp   # switch back if wrong
```

**Never rebase or force-push** without confirming the current tip. `backup/integ-4406-pre-screenshot-move` exists as a safety net — don't delete it.

### 5. The wizard's default is INTERACTIVE

If you spawn `experiences import` with no flags and no TTY, you get the *"experiences import is interactive"* error. Every test that goes headless needs at least one of `--skip-analyze`, `--skip-generate`, `--skip-apply`, `--yes`, `--dry-run`, `--print-prompt`, `--auto-accept-scope`, or `--space-id/--environment-id/--cma-token` to bypass the gate.

### 6. Tokens.json path expectations

The wizard's finalize path reads `<projectPath>/.contentful/tokens.json`. If you're driving through push-through-wizard flows (like `71-import-push-through-wizard.pty.test.mjs`), pre-seed:

```js
mkdirSync(join(projectPath, '.contentful'), { recursive: true });
writeFileSync(join(projectPath, '.contentful', 'tokens.json'), '{}\n');
```

Skip this and the push errors mid-flow with "file not found".

### 7. Mock EMA host scheme

The `mock-ema.mjs` server runs on `http://127.0.0.1:<port>`. The CLI's `toApiHost()` prepends `https://` if the host has no scheme, so:

- **Full URL** — pass `mock.host` (e.g. `http://127.0.0.1:52341`) verbatim to `--host` or in `credentials.json`. Works.
- **Bare host** — passing `127.0.0.1:52341` (no scheme) gets `https://` prepended → fetch fails.

Always use `mock.host` as-is. See `71-import-push-through-wizard.pty.test.mjs` for the working pattern.

### 8. `--modify` needs both runs.json AND pipeline.db

The `--modify` flow reads:
- The run record from `runs.json` (for `extractSessionId`, `savePath`, `projectPath`, etc.)
- The generated CDF from `pipeline.db` (looking up `raw_components` where `status='generated'` for the run's `extractSessionId`)

Seed BOTH via `seedRuns` + `seedPipelineDb`. If pipeline.db is missing, the wizard shows "No generated definitions found for this session".

### 9. Staleness fingerprints

A `sourceFingerprint` in `runs.json` that references a file path that doesn't exist trips the staleness check → "Refusing to replay run — STALE". Use this deliberately to test `--force`. `seedRuns` defaults to `sourceFingerprint: null` which the staleness check treats as UNKNOWN → not stale.

### 10. `--select` and `--deselect` don't work in the wizard

These flags only reach headless `runPipeline`. In the wizard code path, they're dropped on the floor. This is a documented wizard bug (INTEG-4418). Don't waste time writing a PTY test that would fail; use the headless-mode test in `40-import-selection.validation.test.mjs` as your reference.

### 11. Fixture size on the harness branch

The harness branch has the **3-component** react-minimal fixture (Button, Card, Icon). The screenshots branch has the **13-component** version (extended with Badge, Avatar, Modal, Menu, Input, Select, Tab, Toast, Tooltip, Divider). Tests on the harness branch assert `toBe(3)` / `Components (3)`; tests on the screenshots branch assert `toBe(13)` / `Components (13)`. If you extend the fixture on either branch, update the counts.

### 12. Native module: node-pty

`node-pty` needs a native binary. pnpm blocks postinstall scripts by default (`pnpm.onlyBuiltDependencies` allowlists it in the root `package.json`). The `scripts/fix-spawn-helper.mjs` post-install fixes the `+x` bit on the prebuilt `spawn-helper` binary that pnpm strips. If you're troubleshooting a `posix_spawnp failed` error, run that script.

### 13. Session and duration values are non-deterministic

`extractSessionId` etc. are randomly-generated slugs (`quiet-ash-0f43`). Durations vary. Any test that grep-matches those values will flake. Either:
- Match structure, not values (e.g. `.toBe(3)` for a count, not `.toBe('quiet-ash-0f43')` for a name)
- Use regex placeholders (e.g. `/session-\w+/`)

---

## Tier 4 — Keystroke coverage per wizard state

**Size:** ~10-15 tests. No new infra.

**Where they land:** Bulk-add to existing PTY test files. Some naturally fold into existing tests as extra `it` blocks.

**What to cover:**

| State | Keystrokes to exercise | Target file (existing or new) |
|---|---|---|
| **Welcome step** | text entry (`writeText`), `backspace`, `ctrl-u` (clear line), `esc` | `01-welcome.pty.test.mjs` |
| **Run-picker** | `up`/`down` (navigation), `n` (start new), `p` (push), `m` (modify), digit selection, `enter` on selected row, `esc`/`q` | `02-run-picker.pty.test.mjs` |
| **Credentials step** | `tab` cycling Space→Env→Token→Host, empty submit rejection, `esc` cancel | New: `04-credentials.pty.test.mjs` |
| **Scope-gate** | `j`/`k` navigation, `space` toggle single, `A` toggle-all, `a` accept, `f` continue, `s` AI reason toggle, `q` quit | `30-import-flag-to-state.pty.test.mjs` (add) |
| **FieldEditor** (in final-review) | edit text, `Ctrl+S` save, `Esc` discard, `Tab` next field, `Enter` on row → enter field | `61-import-modify-save-modes.pty.test.mjs` (add) |
| **Save-conflict gate** | `o` (overwrite), `s` (skip), `f` (fail) — needs `--on-conflict` write-path unlocked; likely blocked until INTEG-44xx follow-up | Deferred |
| **Push confirmation** | `y`/`n`/`Enter` — needs push-through-wizard flow already exercised in `71-` | `71-import-push-through-wizard.pty.test.mjs` (add) |

**How to write these efficiently:**

1. Reach the target state ONCE per test file (in a shared `spawn` helper), then drive keystrokes and assert on `w.getScreen()` between actions.
2. Use `w.waitFor` after each keystroke to let Ink render before asserting.
3. Prefer the last-frame extraction pattern from Gotcha #2.
4. Test **one keystroke per `it` block**. Combinations quickly become impossible to debug.

**Sample test skeleton for scope-gate keystrokes:**

```js
describe('scope-gate keystrokes', () => {
  const cleanups = [];
  afterEach(() => { while (cleanups.length) cleanups.pop()(); });

  async function reachScopeGate() {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(
      ['import', '--project', REACT_MINIMAL, '--no-push', '--no-auto-filter'],
      { env: t.env, cols: 200, rows: 60 },
    );
    cleanups.push(() => w.close());
    await w.waitFor('Design tokens', { timeout: 10000 });
    w.writeKey('s');
    await w.waitFor(/Found \d+ files/, { timeout: 8000 });
    w.writeKey('enter');
    await w.waitFor(/Components \(3\)/, { timeout: 15000 });
    return w;
  }

  it('space toggles the focused component off', async () => {
    const w = await reachScopeGate();
    // Default: all checked. Space on focused row → uncheck.
    w.writeKey('space');
    await new Promise((r) => setTimeout(r, 500));
    const screen = w.getScreen();
    const lastFrame = screen.slice(screen.lastIndexOf('Components ('));
    expect(lastFrame).toMatch(/\[\s\]\s*Button/); // Button now unchecked
    expect(lastFrame).toMatch(/2\/3 included/);
  });

  // one it() per key
});
```

---

## Tier 5 — Non-`import` subcommands

**Size:** ~30 tests. New fixtures for raw-token formats.

**What's covered elsewhere already:**
- `apply push` — `70-apply-push.validation.test.mjs` (7 tests)

**What to cover:**

### `analyze extract` (~4 tests)
- `--project <path>` — extracts and reports count (already partly covered as pipeline setup)
- `--dir <sub>` — narrows to a subdirectory of the project
- `--resolve-unreachable auto|always|never` — Svelte-specific; may need a `.svelte` fixture
- Output shape assertion (session id, warnings, extracted count)

Fixture: `react-minimal` works for most. For `--resolve-unreachable`, need a Svelte fixture that has an unreachable Props type. Punt if too much effort.

### `analyze select-agent` (~4 tests)
- `--session <id>` — points at a seeded extract session (use `seed-pipeline-db.mjs`)
- `--show-rationale` — reads rejection reasons from `raw_components.reject_reason`
- `--json` — machine-readable output
- `--exclude-invalid` (already partially in `41-import-exclude-invalid.validation.test.mjs` via `import`)

### `analyze select` — the interactive TUI (~5 tests)
This is a DIFFERENT command from `analyze select-agent`. It's a manual TUI with ORIGINAL/EDIT side-by-side panels. Needs:
- Seeded pipeline.db with an extracted session
- PTY drive to reach the TUI
- Assertions on the split-panel layout

Explore `packages/experience-design-system-cli/src/analyze/select/command.ts` for the entry point. Bulk of Tier 5 effort will be here — this TUI has its own state machine.

### `generate components` (~5 tests)
- `--agent claude/codex/opencode/cursor` — verify routing (agent argv log)
- `--model <name>` — verify pass-through
- `--verbose` — output shape
- `--dry-run` vs `--print-prompt` — deprecation notice on bare `--dry-run`
- `--generate-prompt-path <path>` — custom prompt banner
- `--session <id>` — points at a seeded extract session

Most of these are already covered in Tier 3 via `import` (which invokes `generate components` internally). The subcommand-direct tests just add explicit coverage.

### `generate tokens` (~4 tests)
- `--raw-tokens <path>` for each format: SCSS, CSS vars, JS/TS, Style Dictionary
- `--session <id>` for resume

**New fixtures needed:** `fixtures/tokens/vars.scss`, `vars.css`, `vars.js`, `style-dictionary.json`. Each ~20 lines with a mix of color/spacing/typography tokens.

### `apply diff` (~3 tests)
Runs preview against a mock EMA and prints a diff. Same shape as `apply push --dry-run` in the wire-level codepath.

- `--components <path>` + creds → diff renders
- `--session <id>` → loads from pipeline.db
- 400 preview error surfaces

Existing `mock-ema.mjs` covers all endpoints needed.

### `apply select` (~4 tests)
Interactive TUI for picking which entities to push. Similar shape to `analyze select` — split-panel selector.

- `--select-all` flag skips the TUI
- `--select <pattern>` / `--deselect <pattern>` prefilters
- `--force` bypasses breaking-changes prompt
- Interactive TUI navigation (arrows, space, enter)

### `print components/tokens/validate` (~4 tests)
- `print components --session <id> --out <path>` — writes CDF to disk
- `print tokens --session <id> --out <path>` — writes DTCG
- `print validate --components <path> --tokens <path>` — validates against schema
- Error paths (missing session, invalid paths)

---

## Tier 6 — Cross-cutting

**Size:** ~10 tests. Adds one small helper.

**What to cover:**

| Concern | Test |
|---|---|
| Non-TTY invocation with `TERM=dumb` | Wizard reports interactive-required error cleanly; JSON output remains valid |
| PTY resize mid-render | `w.term.resize(cols, rows)` while at scope-gate → layout adapts, no crash |
| Ctrl-c at every wizard state | Welcome, tokens step, scanning, scope-gate, generate, final-review → clean exit |
| Ctrl-c during in-flight push | SIGINT during mock-EMA-delayed apply → exit code 130, no partial state written |
| runs.json v1 → v3 auto-migration | Seed each format, verify picker reads all three |
| Broken runs.json | Malformed JSON → picker skipped silently, wizard starts at welcome with warning |
| Missing credentials.json | New credentials path prompted in TTY mode; verify write on submit |
| Malformed `EDS_AGENT_BINARY_*` | Points at nonexistent path → clear error surface; points at script that exits 1 → error propagated |
| Real-agent opt-in smoke test | `stub_agents: false` on MCP server; hits actual `claude` binary if present. **Nightly job, not blocking.** |

**One new helper needed:** `seed-runs-legacy.mjs` — writes runs.json in v1 or v2 format so you can assert on auto-migration.

**Runs.json versioning reference:**
- `runs/store.ts:RUNS_FILE_VERSION = 3` — current writer version
- `runs/store.ts:READABLE_VERSIONS = new Set([1, 2, 3])` — versions the migrator accepts
- Look at the migration code in `store.ts` for the shape diffs between v1/v2/v3

---

## Recommended sequencing

1. **Tier 4 first** — smallest, no new infra, closes out the wizard states we've already invested in.
2. **Tier 6 defensive tests** — before Tier 5's expansion, since these are cheap and catch regressions in code we already exercise.
3. **Tier 5** — the biggest expansion. Start with `analyze select-agent` and `generate` variants (most of the infra is done), then tackle the interactive `analyze select` and `apply select` TUIs (harder, but only 2 places to build TUI-driving patterns).

---

## Success criteria

**Definition of done for the harness overall** (all tiers complete):
- Every `process.exit(1)` in every `*/command.ts` under `packages/experience-design-system-cli/src/` has a Tier 2-style test.
- Every subcommand has at least one Tier 3-style test proving it runs against fixtures.
- Every wizard state has at least one Tier 4 test exercising its keystrokes.
- Every cross-cutting concern in Tier 6 has a test.
- Suite runs green 5 times consecutively in `pnpm exec nx run dsi-pty-harness:pty-test`.
- The four wizard bugs (INTEG-4418, 4419, 4420, 4421) are either fixed with tests un-deferred, or explicitly marked ⏭️ in the coverage plan.

**Ship criteria for this branch specifically:**
- Tests you added are green.
- You didn't add new wizard bugs.
- Coverage plan is updated to reflect what you did.
- Branch is pushed to origin; commits are conventional-commits format; each commit is signed with `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.

---

## Filed / known bugs blocking specific tests

- **INTEG-4417** (parent): four flags with headless plumbing but no WizardApp plumbing.
  - **INTEG-4418** — `--select` / `--deselect` don't reach the wizard's scope-gate. Blocks Tier 4 scope-gate pre-selection tests.
  - **INTEG-4419** — `--yes` never reaches WizardApp. Blocks Tier 4 push-confirmation-with-flag tests.
  - **INTEG-4420** — `--no-live-preview` dropped on `--modify` / `--push-from-run`. Blocks live-preview-toggle tests.
  - **INTEG-4421** — Orchestrator drops `--exclude-invalid` on the analyze-select (non-agent) branch. Blocks the `--select-all --exclude-invalid` combination test.

Each subtask has a fix sketch. When the fix lands, the corresponding deferred tests can be un-deferred.

---

## Coordinates

- **Ticket:** [INTEG-4406](https://contentful.atlassian.net/browse/INTEG-4406) — parent tracking issue
- **Branch:** `feat/integ-4406-pty-harness-mcp` at commit `5f6b1fb` (tip after screenshot cleanup)
- **Companion branch:** `feat/integ-4406-pty-harness-screenshots` at commit `7edbbe7` (docs-tooling, separate PR)
- **Backup:** `backup/integ-4406-pre-screenshot-move` at commit `42cb6e3` (pre-split state, safety net)

Full flag matrix + wizard-bug analysis: `docs/test-coverage-plan.md`. Read it once before writing any new tests.

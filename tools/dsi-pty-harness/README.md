# @contentful/dsi-pty-harness

PTY-based test harness and MCP server for driving the `experiences` CLI wizard
end-to-end. Spawns the Ink TUI inside a real pseudo-terminal so tests exercise
raw-mode input, `useStdin`, focus, and real `child_process` spawns — none of
which `ink-testing-library` can cover.

Private workspace package. Not published.

## Contents

- `src/harness.mjs` — `spawnWizard()` API (`writeKey`, `writeText`, `waitFor`,
  `getScreen`, `getRaw`, `close`) over `node-pty` + `strip-ansi`.
- `src/stub-agent.mjs` — offline agent stub that responds to `auth status --json`
  and emits a canned `<<<EDS_OUTPUT_*>>>` payload. Selected via
  `EDS_AGENT_BINARY_CLAUDE` / `_CODEX` / `_OPENCODE` / `_CURSOR` env overrides
  in `agent-runner.ts`.
- `src/mcp-server.mjs` — stdio MCP server exposing the harness for interactive
  LLM-driven testing.
- `tests/*.pty.test.mjs` — vitest smoke tests. Opt-in via `PTY_TESTS=1`.

## First-time setup

```bash
# From repo root
pnpm install
pnpm exec nx build experience-design-system-cli

# If any PTY test exits immediately with an empty screen buffer,
# the node-pty spawn-helper is missing its +x bit — run:
node tools/dsi-pty-harness/scripts/fix-spawn-helper.mjs
```

The root `postinstall` in `package.json` runs `fix-spawn-helper.mjs`
automatically after every `pnpm install`. If you skipped scripts
(`pnpm install --ignore-scripts`), ran a partial install, or otherwise
end up with `posix_spawnp failed` / empty PTY output, run the helper
directly.

## Running the suite

From the repo root:

```bash
# Preferred — builds the CLI first via nx, then runs the suite
pnpm exec nx run dsi-pty-harness:pty-test

# Or, if the CLI is already built:
PTY_TESTS=1 pnpm --filter @contentful/dsi-pty-harness exec vitest run
```

The tests spawn the already-built CLI binary from
`packages/experience-design-system-cli/dist/`, not from source. The nx
target ensures the build ran first; the direct vitest command skips
that check.

`vitest` in this package only picks up `*.pty.test.mjs` /
`*.validation.test.mjs` when `PTY_TESTS=1` is set, so `nx test` /
`pnpm test` at the repo root is a no-op for this package.

### Debugging a failing test

Set `PTY_DEBUG=1` to have the harness's headless runCli helper +
seed-pipeline-db.mjs dump every spawned argv, environment override,
exit code, full stdout/stderr, and every rewritten `source_path` row:

```bash
PTY_DEBUG=1 PTY_TESTS=1 pnpm --filter @contentful/dsi-pty-harness \
  exec vitest run test/analyze/select.validation.test.mjs
```

Useful when a test passes on one machine and fails on another — the
dump surfaces which env vars the CLI actually saw, whether the seeded
component source files exist on this machine, and the wizard's full
error output.

### node-pty native module

`node-pty` ships prebuilt binaries. pnpm strips the execute bit on
`prebuilds/*/spawn-helper`, which breaks the module — the root `postinstall`
runs `tools/dsi-pty-harness/scripts/fix-spawn-helper.mjs` to restore it.


## MCP server

Wire the server into Claude Code:

```bash
claude mcp add eds-tui -- node /abs/path/to/tools/dsi-pty-harness/bin/mcp.mjs
```

Then Claude gets these tools:

| Tool             | What it does                                                     |
|------------------|------------------------------------------------------------------|
| `spawn_wizard`   | Launch `experiences <args>` in a PTY. Returns a `sessionId`.     |
| `send_keys`      | Send named keys (`enter`, `tab`, `ctrl-c`, arrows, chars, …).   |
| `send_text`      | Write a literal string (no implicit enter).                      |
| `wait_for`       | Poll the screen for a string / regex. Returns matched tail.      |
| `read_screen`    | Return the current buffer (ANSI-stripped tail by default).       |
| `close`          | Terminate the PTY child.                                         |
| `list_sessions`  | List live sessions.                                              |

By default `spawn_wizard` prepends the stub-agent env overrides so the wizard
never hits a real LLM. Pass `stub_agents: false` to run against real
`claude` / `codex` binaries on `$PATH`.

## Env override in `agent-runner.ts`

`resolveBinary()` honors `EDS_AGENT_BINARY_<NAME>` per agent, e.g.
`EDS_AGENT_BINARY_CLAUDE=/opt/custom/claude`. This is also how the harness
routes the wizard to the stub — see `stubAgentEnv()` in `src/harness.mjs`.

## Adding a test

```js
import { describe, it, expect, afterEach } from 'vitest';
import { spawnWizard } from '../src/harness.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';

describe('my flow', () => {
  const cleanups = [];
  afterEach(() => { while (cleanups.length) cleanups.pop()(); });

  it('does the thing', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(['import'], { env: t.env });
    cleanups.push(() => w.close());

    await w.waitFor('Where is your component library?');
    w.writeText('/tmp/fake-project');
    w.writeKey('enter');
    await w.waitFor(/component|token/i);
  });
});
```

`makeTmpHome()` gives each test an isolated `HOME` so `~/.config/experiences/runs.json`
etc. don't leak between runs.

### Seeded fixtures

Tests that need the wizard to reach final-review / push / modify need a
valid pipeline.db + runs.json + tokens.json placeholders. Pass a `seed`
option to `makeTmpHome` and it wires the whole thing up:

```js
const t = makeTmpHome({ seed: 'default' })
// t.dbPath          — copied pipeline.db under $HOME
// t.savePath        — <home>/save/ with a tokens.json placeholder
// t.projectPath     — <home>/fake-project/ with .contentful/tokens.json
// t.runId           — 'run-seeded' (already in runs.json)
// t.sessionId       — SEEDED_SESSION_ID from the fixture DB
// t.env.EDS_PIPELINE_DB_PATH — wired through so the CLI opens the seed
```

Use `seed: 'with-props'` for the FieldEditor per-field tests (variant
of pipeline.db whose raw_props have populated `cdf_type` +
`cdf_category`).

Tests that intentionally want a bare HOME (runs.json v1/v2 migration,
malformed-file handling, "no prior runs" flows) omit the `seed`
option.

## Not on Windows

Ubuntu + macOS only. `node-pty` on Windows uses ConPTY and behaves differently.

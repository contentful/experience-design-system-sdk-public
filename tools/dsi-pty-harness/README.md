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

## Local

```bash
# From repo root, first time
pnpm install
pnpm exec nx build experience-design-system-cli

# Run the PTY smoke tests
pnpm exec nx run dsi-pty-harness:pty-test

# Real agents (skips stub) — hits actual claude/codex on $PATH.
# Not run in CI.
EDS_PTY_REAL_AGENT=1 pnpm exec nx run dsi-pty-harness:pty-test
```

`vitest` in this package only picks up `*.pty.test.mjs` when `PTY_TESTS=1` is
set, so `nx test` / `pnpm test` at the repo root is a no-op for this package.

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

## Not on Windows

Ubuntu + macOS only. `node-pty` on Windows uses ConPTY and behaves differently.

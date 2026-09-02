/**
 * PTY-driven test harness for the experience-design-system-cli wizard.
 *
 * Spawns the `experiences` CLI inside a pseudo-terminal so the Ink-based TUI
 * renders the same way it would for a human operator, then exposes a small
 * keystroke + screen-assertion API for tests and the accompanying MCP server.
 */
import pty from 'node-pty';
import stripAnsi from 'strip-ansi';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const KEY_MAP = {
  enter: '\r',
  return: '\r',
  tab: '\t',
  esc: '\x1b',
  escape: '\x1b',
  space: ' ',
  backspace: '\x7f',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  home: '\x1b[H',
  end: '\x1b[F',
  'ctrl-c': '\x03',
  'ctrl-d': '\x04',
  'ctrl-s': '\x13',
};

function encodeKey(key) {
  if (key in KEY_MAP) return KEY_MAP[key];
  if (key.length === 1) return key;
  throw new Error(`Unknown key: ${key}`);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');
const STUB_AGENT = resolve(HERE, 'stub-agent.mjs');

const DEFAULT_CLI_BIN = resolve(
  PKG_ROOT,
  '../../packages/experience-design-system-cli/bin/cli.js',
);

/**
 * Build an env block that shadows the agent binaries with the stub.
 * Uses the new EDS_AGENT_BINARY_* override (see agent-runner.ts) —
 * no $PATH surgery required.
 */
export function stubAgentEnv(base = {}) {
  return {
    ...base,
    EDS_AGENT_BINARY_CLAUDE: STUB_AGENT,
    EDS_AGENT_BINARY_CODEX: STUB_AGENT,
    EDS_AGENT_BINARY_OPENCODE: STUB_AGENT,
    EDS_AGENT_BINARY_CURSOR: STUB_AGENT,
  };
}

/**
 * Spawn `experiences <args>` inside a PTY.
 *
 * @param {string[]} args   argv to pass to the CLI
 * @param {object}   opts
 * @param {object}   [opts.env]        extra env vars merged onto process.env
 * @param {string}   [opts.cwd]        working directory
 * @param {string}   [opts.binary]     override the `experiences` binary path
 * @param {boolean}  [opts.stubAgents] shadow claude/codex/etc. with the stub (default true)
 * @param {number}   [opts.cols]       PTY width (default 120)
 * @param {number}   [opts.rows]       PTY height (default 40)
 * @param {boolean}  [opts.debug]      mirror PTY output to stdout
 */
export async function spawnWizard(args, opts = {}) {
  const baseEnv = { ...process.env, ...(opts.env ?? {}) };
  const env = opts.stubAgents === false ? baseEnv : stubAgentEnv(baseEnv);

  const binary =
    opts.binary ?? env.EXPERIENCES_BIN ?? process.env.EXPERIENCES_BIN ?? DEFAULT_CLI_BIN;
  const cols = opts.cols ?? 120;
  const rows = opts.rows ?? 40;

  // The CLI bin is a Node script — spawn `node <script>` directly so we don't
  // depend on the shebang or a shell.
  const spawnBin = 'node';
  const spawnArgs = [binary, ...args];

  const term = pty.spawn(spawnBin, spawnArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: opts.cwd ?? process.cwd(),
    env,
  });

  let buffer = '';
  // PTY_HARNESS_DEBUG=1 mirrors every byte the child writes to stderr,
  // prefixed with the child pid. Useful in CI when a wait_for times out
  // with an empty screen — the mirrored bytes prove whether the child
  // produced any output at all before termination.
  const mirrorDebug = process.env.PTY_HARNESS_DEBUG === '1';
  term.onData((data) => {
    buffer += data;
    if (opts.debug) process.stdout.write(data);
    if (mirrorDebug) process.stderr.write(`[pty-${term.pid}] ${data}`);
  });

  let exited = false;
  let exitInfo = null;
  term.onExit((info) => {
    exited = true;
    exitInfo = info;
  });

  const getScreen = () => stripAnsi(buffer);
  const getRaw = () => buffer;

  const writeKey = (key) => term.write(encodeKey(key));
  const writeKeys = (keys) => {
    for (const k of keys) term.write(encodeKey(k));
  };
  const writeText = (text) => term.write(text);

  const waitFor = async (pattern, { timeout = 5000, interval = 50 } = {}) => {
    const start = Date.now();
    const matches = (s) =>
      pattern instanceof RegExp ? pattern.test(s) : s.includes(pattern);
    while (Date.now() - start < timeout) {
      const screen = getScreen();
      if (matches(screen)) return screen;
      if (exited) {
        throw new Error(
          `Process exited (code=${exitInfo?.exitCode}) before pattern matched: ${pattern}\n--- SCREEN ---\n${screen}`,
        );
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    const screen = getScreen();
    const raw = getRaw();
    throw new Error(
      `Timeout (${timeout}ms) waiting for: ${pattern}\n` +
        `pid=${term.pid} exited=${exited} exitInfo=${JSON.stringify(exitInfo)} rawBytes=${raw.length}\n` +
        `--- SCREEN ---\n${screen}\n` +
        `--- RAW (first 400) ---\n${raw.slice(0, 400)}`,
    );
  };

  const close = async () => {
    if (!exited) {
      try {
        term.write('\x03');
      } catch {}
      try {
        term.kill();
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 50));
  };

  const isExited = () => exited;
  const getExitInfo = () => exitInfo;

  return {
    writeKey,
    writeKeys,
    writeText,
    waitFor,
    getScreen,
    getRaw,
    close,
    isExited,
    getExitInfo,
    term,
  };
}

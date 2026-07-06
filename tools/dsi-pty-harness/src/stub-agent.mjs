#!/usr/bin/env node
/**
 * Stub agent binary that masquerades as `claude` (or codex/opencode/cursor)
 * for the experience-design-system-cli wizard.
 *
 * Point the CLI at this stub via env override:
 *   EDS_AGENT_BINARY_CLAUDE=/path/to/stub-agent.mjs
 * (see packages/experience-design-system-cli/src/generate/agent-runner.ts
 * `resolveBinary`). The harness's `stubAgentEnv()` does this for every
 * supported agent name.
 *
 * Subcommands handled:
 *   - `auth status --json` : auth probe (returns ok)
 *   - everything else      : emit canned progress + a minimal CDF result
 *
 * Override behavior with env vars:
 *   STUB_EXIT_CODE   : exit code (default 0)
 *   STUB_DELAY_MS    : delay before emitting result (default 50)
 *   STUB_STDOUT_FILE : if set, write this file's contents to stdout instead
 *   STUB_STDERR_FILE : if set, write this file's contents to stderr instead
 *   STUB_ARGV_LOG    : if set, append one JSON line per invocation to this
 *                      file with { argv, cwd, ts }. Lets tests assert what
 *                      flags the wizard passed through (e.g. --model).
 */
import { appendFileSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const sub = argv[0];

if (process.env.STUB_ARGV_LOG) {
  try {
    appendFileSync(
      process.env.STUB_ARGV_LOG,
      JSON.stringify({ argv, cwd: process.cwd() }) + '\n',
    );
  } catch {}
}

// --- auth probe ---------------------------------------------------------
if (sub === 'auth' && argv[1] === 'status') {
  // The wizard's checkAgentAuth() parses this and looks for `loggedIn: true`.
  // Also emit `status` for anything that reads that shape instead.
  process.stdout.write(
    JSON.stringify({ loggedIn: true, status: 'authenticated' }) + '\n',
  );
  process.exit(0);
}

// --- file-driven override -----------------------------------------------
if (process.env.STUB_STDOUT_FILE) {
  process.stdout.write(readFileSync(process.env.STUB_STDOUT_FILE, 'utf8'));
}
if (process.env.STUB_STDERR_FILE) {
  process.stderr.write(readFileSync(process.env.STUB_STDERR_FILE, 'utf8'));
}

// --- default canned response --------------------------------------------
const delay = Number(process.env.STUB_DELAY_MS ?? 50);
const exitCode = Number(process.env.STUB_EXIT_CODE ?? 0);

// Best-effort prop recovery from the prompt argv. The wizard's parser
// (agent-runner.ts:parseToolCallLines) reads tool-call JSON one-per-line
// off stdout — no fencing. Emit a classify_component + one classify_prop
// per detected prop so the pipeline never trips "agent produced no tool
// calls" when generate is invoked against the react-minimal fixture.
function findPropsInPrompt() {
  const prompt = argv.join(' ');
  const props = new Set();
  for (const m of prompt.matchAll(
    /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\??\s*:\s*(string|number|boolean|ReactNode|ReactElement|[A-Z][a-zA-Z]*)/g,
  )) {
    const name = m[1];
    if (!name) continue;
    if (['type', 'interface', 'export', 'import', 'default', 'React'].includes(name)) continue;
    props.add(name);
    if (props.size >= 4) break;
  }
  return [...props];
}

setTimeout(() => {
  process.stderr.write('progress=starting\n');
  process.stderr.write('progress=analyzing\n');

  process.stdout.write(
    JSON.stringify({
      tool: 'classify_component',
      description: 'stub-generated component',
    }) + '\n',
  );
  for (const prop of findPropsInPrompt()) {
    process.stdout.write(
      JSON.stringify({
        tool: 'classify_prop',
        prop,
        cdf_type: 'string',
        cdf_category: 'content',
      }) + '\n',
    );
  }

  process.stderr.write('progress=done\n');
  process.exit(exitCode);
}, delay);

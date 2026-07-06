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
 */
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const sub = argv[0];

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

setTimeout(() => {
  // Emit a couple of progress=… stderr lines so the wizard sees activity.
  process.stderr.write('progress=starting\n');
  process.stderr.write('progress=analyzing\n');
  process.stderr.write('progress=done\n');

  // Emit a fenced EDS_OUTPUT block on stdout (matches the parser in
  // agent-runner.ts). Content is an intentionally-minimal placeholder.
  const payload = JSON.stringify({
    components: [],
    notes: 'stub-agent canned response',
  });
  process.stdout.write('<<<EDS_OUTPUT_START>>>\n');
  process.stdout.write(payload + '\n');
  process.stdout.write('<<<EDS_OUTPUT_END>>>\n');

  process.exit(exitCode);
}, delay);

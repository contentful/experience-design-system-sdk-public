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

/**
 * Detect which command's prompt we were handed. The select-agent skill
 * (skills/select-components.md) uses the `select_component` / `reject_component`
 * tool vocabulary; the generate-components skill uses `classify_prop` / etc.
 * The prompt is passed as the last argv element for all supported agents.
 */
function detectPromptKind() {
  const prompt = argv.join(' ');
  if (/select_component\b|reject_component\b/.test(prompt)) return 'select';
  return 'classify';
}

/**
 * Enumerate every component the wizard's select-agent prompt is asking
 * about. The prompt embeds each candidate as a JSON object with a
 * `"path": "src/.../<Name>.tsx"` field. Extract those, de-duplicate,
 * and return the derived component names in first-seen order.
 *
 * Falls back to a single generic name if no paths match (the skill
 * prompt's few-shot examples reference synthetic names in string
 * literals, but they don't have `"path"` JSON fields).
 */
function findSelectBatchNames() {
  const prompt = argv.join(' ');
  const seen = new Set();
  const names = [];
  for (const m of prompt.matchAll(/"path"\s*:\s*"[^"]*\/([A-Z][A-Za-z0-9_]*)\.[jt]sx?"/g)) {
    const n = m[1];
    if (seen.has(n)) continue;
    seen.add(n);
    names.push(n);
  }
  if (names.length === 0) {
    const m =
      /Component name:\s*([A-Z][A-Za-z0-9_]*)/.exec(prompt) ||
      /component named\s+([A-Z][A-Za-z0-9_]*)/i.exec(prompt);
    names.push(m ? m[1] : 'Component');
  }
  return names;
}

/** Fixture-specific reject set — makes docs images show BOTH sections. */
const REJECT_NAMES = new Set(['Modal', 'Divider']);

setTimeout(() => {
  const kind = detectPromptKind();
  process.stderr.write('progress=starting\n');
  process.stderr.write('progress=analyzing\n');

  if (kind === 'select') {
    const names = findSelectBatchNames();
    for (const name of names) {
      if (REJECT_NAMES.has(name)) {
        process.stdout.write(
          JSON.stringify({
            tool: 'reject_component',
            name,
            reason: 'structural/utility — no authorable content surface',
            confidence: 4,
          }) + '\n',
        );
      } else {
        process.stdout.write(
          JSON.stringify({
            tool: 'select_component',
            name,
            reason: 'has authorable props (label / title / children)',
            confidence: 5,
          }) + '\n',
        );
      }
    }
  } else {
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
  }

  process.stderr.write('progress=done\n');
  process.exit(exitCode);
}, delay);

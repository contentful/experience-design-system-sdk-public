import { spawn } from 'node:child_process';
import type { CompositionEdge } from '../interchange-schema.js';

export type SandboxCtx = {
  files: Array<{ path: string; content: string }>;
  componentNames: string[];
};

export type SandboxResult = {
  edges: CompositionEdge[];
  error?: string;
};

const DEFAULT_TIMEOUT_MS = 5000;
const HEAP_CAP_MB = 128;
const MAX_INPUT_BYTES = 8 * 1024 * 1024; // refuse absurd ctx up front

/**
 * Execute agent-authored parser source under two nested jails (spec:
 * dsi-agent-authored-parser-design, Phase 1 — the security core).
 *
 * OUTER — a throwaway child `node` process: `env: {}` (no secrets/tokens leak
 * even on a full escape), a heap cap (`--max-old-space-size`, OOM self-kills),
 * and a wall-clock `SIGKILL` the parent enforces for any hang (sync or async).
 *
 * INNER — a `node:vm` context created from a null-prototype object, an
 * ALLOW-LIST: it has only ECMAScript intrinsics (Object/Array/JSON/Math/RegExp
 * …). There is no `process`, `require`, `Buffer`, `fetch`, timers, or module
 * loader in scope, so the parser cannot reach them — and only STRINGS cross
 * the boundary (source + JSON-encoded ctx), so there is no host-object handle
 * for the classic `this.constructor.constructor('return process')()` escape to
 * climb. `vm.runInContext(..., { timeout })` kills sync infinite loops.
 *
 * The parser must be SYNCHRONOUS — an async/thenable return is rejected, which
 * closes the async-timeout gap (vm `timeout` covers sync execution only).
 *
 * Any failure — throw, timeout, OOM, denied access, bad/async return, compile
 * error — resolves to `{ edges: [], error }` and is NEVER thrown. Returned
 * edges are shape-validated here; the caller still re-verifies parent/child
 * against the component name set.
 */
export function runParserInSandbox(
  source: string,
  ctx: SandboxCtx,
  opts: { timeoutMs?: number } = {},
): Promise<SandboxResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<SandboxResult>((resolve) => {
    let input: string;
    try {
      input = JSON.stringify({ source, ctx, timeoutMs });
    } catch {
      resolve({ edges: [], error: 'ctx is not serializable' });
      return;
    }
    if (input.length > MAX_INPUT_BYTES) {
      resolve({ edges: [], error: 'parser input exceeds size limit' });
      return;
    }

    let settled = false;
    let stdout = '';
    let stderr = '';

    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${HEAP_CAP_MB}`, '--input-type=module', '-e', RUNNER],
      // No inherited env (secrets stay out of the jail), neutral cwd, no argv.
      { env: {}, cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] },
    );

    const done = (r: SandboxResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      resolve(r);
    };

    // Wall-clock backstop (covers async hangs the vm timeout can't). Grace over
    // the inner timeout so the vm-level error is preferred when it fires first.
    const timer = setTimeout(
      () => done({ edges: [], error: `parser timed out after ${timeoutMs}ms` }),
      timeoutMs + 1000,
    );

    child.stdout.on('data', (c: Buffer) => {
      stdout += String(c);
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += String(c);
    });
    child.on('error', (e) => done({ edges: [], error: `sandbox spawn failed: ${e.message}` }));
    child.on('close', (code, signal) => {
      if (settled) return;
      if (signal === 'SIGKILL') {
        done({ edges: [], error: 'parser killed (timeout or memory limit)' });
        return;
      }
      let msg: { ok?: boolean; edges?: unknown; error?: string };
      try {
        msg = JSON.parse(stdout);
      } catch {
        done({
          edges: [],
          error: `sandbox produced no result (code ${code})${stderr ? `: ${stderr.slice(0, 200)}` : ''}`,
        });
        return;
      }
      if (msg.ok) done({ edges: sanitizeEdges(msg.edges) });
      else done({ edges: [], error: msg.error ?? 'parser failed' });
    });

    try {
      child.stdin.on('error', () => {});
      child.stdin.write(input);
      child.stdin.end();
    } catch {
      done({ edges: [], error: 'failed to send input to sandbox' });
    }
  });
}

/** Keep only well-formed edges: parent+child non-empty strings. */
function sanitizeEdges(raw: unknown): CompositionEdge[] {
  if (!Array.isArray(raw)) return [];
  const out: CompositionEdge[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const rec = e as Record<string, unknown>;
    if (typeof rec.parent !== 'string' || rec.parent === '') continue;
    if (typeof rec.child !== 'string' || rec.child === '') continue;
    const edge: CompositionEdge = { parent: rec.parent, child: rec.child, provenance: 'adapter:agent-parser' };
    if (typeof rec.slot === 'string' && rec.slot !== '') edge.slot = rec.slot;
    if (typeof rec.confidence === 'number' && rec.confidence >= 1 && rec.confidence <= 5)
      edge.confidence = rec.confidence;
    out.push(edge);
  }
  return out;
}

/**
 * Child-process runner (trusted — OUR code). Reads {source, ctx, timeoutMs}
 * from stdin, runs the parser inside a vm allow-list context, writes a single
 * JSON result to stdout. Only strings enter the vm; only a JSON string leaves.
 */
const RUNNER = `
import vm from 'node:vm';
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let out;
  try {
    const { source, ctx, timeoutMs } = JSON.parse(input);
    // Null-prototype global: no inherited host props. The context still gets
    // ECMAScript intrinsics (Object/Array/JSON/Function/Math/RegExp), but NOT
    // process/require/Buffer/timers/module.
    const context = vm.createContext(Object.create(null));
    // Cross the boundary as PRIMITIVES only — no host object/function handle
    // for a prototype-chain escape to grab.
    context.__source = String(source);
    context.__ctxJson = JSON.stringify(ctx);
    const bootstrap = [
      '(function () {',
      '  var ctx = JSON.parse(__ctxJson);',
      "  var body = String(__source).replace(/export\\\\s+default\\\\s+/, 'return ');",
      '  var factory = Function(body);',          // the vm context's own Function
      '  var parser = factory();',
      "  if (typeof parser !== 'function') return JSON.stringify({ ok: false, error: 'parser source did not resolve to a function' });",
      '  var result = parser(ctx);',
      "  if (result && typeof result.then === 'function') return JSON.stringify({ ok: false, error: 'parser must be synchronous' });",
      "  if (!Array.isArray(result)) return JSON.stringify({ ok: false, error: 'parser did not return an array' });",
      '  return JSON.stringify({ ok: true, edges: result });',
      '})()',
    ].join('\\n');
    out = vm.runInContext(bootstrap, context, { timeout: timeoutMs });
  } catch (e) {
    out = JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) });
  }
  try { process.stdout.write(typeof out === 'string' ? out : JSON.stringify({ ok: false, error: 'no result' })); }
  catch { process.stdout.write(JSON.stringify({ ok: false, error: 'result not serializable' })); }
});
`;

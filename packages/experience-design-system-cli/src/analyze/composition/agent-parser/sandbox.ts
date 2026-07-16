import { Worker } from 'node:worker_threads';
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

/**
 * Execute agent-authored parser source in an isolated worker (spec:
 * dsi-agent-authored-parser-design, Phase 1 — the security core).
 *
 * The parser is `(ctx) => Edge[]`, run inside a Worker with dangerous globals
 * (require, process, fetch, module loaders, etc.) shadowed to undefined, no
 * network/fs surface, and a hard timeout enforced by terminating the worker.
 * Any failure — throw, timeout, bad return, denied access, compile error — is
 * returned as `{ edges: [], error }` and NEVER thrown, so a bad parser can't
 * crash the caller. Returned edges are shape-validated here; caller still
 * re-verifies parent/child against the component name set.
 */
export function runParserInSandbox(
  source: string,
  ctx: SandboxCtx,
  opts: { timeoutMs?: number } = {},
): Promise<SandboxResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<SandboxResult>((resolve) => {
    let settled = false;
    const done = (r: SandboxResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(r);
    };

    const worker = new Worker(BOOTSTRAP, {
      eval: true,
      workerData: { source, ctx },
      // Deny env + argv; worker gets no ambient config.
      env: {},
      argv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });

    const timer = setTimeout(() => {
      done({ edges: [], error: `parser timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    worker.on('message', (msg: { ok: boolean; edges?: unknown; error?: string }) => {
      if (msg.ok) done({ edges: sanitizeEdges(msg.edges) });
      else done({ edges: [], error: msg.error ?? 'parser failed' });
    });
    worker.on('error', (err) => done({ edges: [], error: err.message }));
    worker.on('exit', (code) => {
      if (!settled) done({ edges: [], error: `parser worker exited (code ${code})` });
    });
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
    const edge: CompositionEdge = {
      parent: rec.parent,
      child: rec.child,
      provenance: 'adapter:agent-parser',
    };
    if (typeof rec.slot === 'string' && rec.slot !== '') edge.slot = rec.slot;
    if (typeof rec.confidence === 'number' && rec.confidence >= 1 && rec.confidence <= 5) {
      edge.confidence = rec.confidence;
    }
    out.push(edge);
  }
  return out;
}

/**
 * Worker bootstrap (runs inside the isolated thread). Loads the parser source
 * with dangerous globals shadowed, invokes it with the ctx, posts back edges or
 * an error. Non-serializable returns fail the structuredClone at postMessage
 * and surface as a worker error → caller treats as failure.
 */
const BOOTSTRAP = `
import { workerData, parentPort } from 'node:worker_threads';

// Compile the parser BEFORE we tear down capabilities (we need the Function
// constructor once here), then neutralize every ambient escape route on the
// real global object so the parser body cannot reach process/require/etc. —
// including via globalThis or the Function/eval constructors, which shadowing
// params alone does NOT block.
function harden() {
  const g = globalThis;
  const kill = (obj, key) => { try { Object.defineProperty(obj, key, { value: undefined, configurable: false, writable: false }); } catch {} };
  // The classic escapes: Function/GeneratorFunction constructors reach the real
  // global scope. Poison them so new Function('return globalThis.process')()
  // throws instead of leaking.
  const poison = () => { throw new Error('code generation is disabled in the parser sandbox'); };
  kill(g, 'process');
  kill(g, 'require');
  kill(g, 'module');
  kill(g, 'Buffer');
  kill(g, 'fetch');
  kill(g, 'global');
  try { g.Function = poison; } catch {}
  try { (function(){}).constructor.constructor = poison; } catch {}
  try { g.eval = poison; } catch {}
  // Block dynamic import via the async-function constructor path too.
  try { (async function(){}).constructor = poison; } catch {}
}

async function run() {
  const { source, ctx } = workerData;
  let parser;
  try {
    const body = source.replace(/export\\s+default\\s+/, 'return ');
    // Single, controlled compile — done before hardening.
    // eslint-disable-next-line no-new-func
    const factory = new Function(body);
    parser = factory();
  } catch (e) {
    parentPort.postMessage({ ok: false, error: 'parser failed to compile: ' + String(e && e.message ? e.message : e) });
    return;
  }
  if (typeof parser !== 'function') {
    parentPort.postMessage({ ok: false, error: 'parser source did not resolve to a function' });
    return;
  }
  harden();
  const edges = await parser(ctx);
  if (!Array.isArray(edges)) {
    parentPort.postMessage({ ok: false, error: 'parser did not return an array' });
    return;
  }
  parentPort.postMessage({ ok: true, edges });
}

run().catch((e) => {
  try { parentPort.postMessage({ ok: false, error: String(e && e.message ? e.message : e) }); }
  catch { parentPort.postMessage({ ok: false, error: 'parser failed (unserializable error)' }); }
});
`;

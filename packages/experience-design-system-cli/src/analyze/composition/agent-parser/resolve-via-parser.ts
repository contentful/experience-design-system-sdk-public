import type { CompositionEdge } from '../interchange-schema.js';
import { buildAuthorPrompt } from './author-prompt.js';
import { extractParserSource } from './extract-parser.js';
import { runParserInSandbox } from './sandbox.js';

export type ResolveViaParserResult = {
  edges: CompositionEdge[];
  warnings: string[];
  /** True when authoring/execution failed and the caller should fall back to
   *  direct edge-emission (or no composition). */
  usedFallback: boolean;
  /** The authored parser source, when one ran successfully (for caching). */
  parserSource?: string;
};

/**
 * Agent-authored parser path (spec: agent-authored-parser, Phase 2).
 *
 * Ask the agent to WRITE a pure `(ctx) => Edge[]` parser, run it in the
 * sandbox, and verify its edges against the component name set. One repair
 * round if the authored parser fails to run; otherwise signal fallback. The
 * agent call is injected so this is testable without spawning a subprocess.
 */
export async function resolveViaAgentParser(input: {
  /** Files inlined into the authoring prompt — a bounded candidate sample so
   *  the agent sees the convention without ingesting the whole repo. */
  files: Array<{ path: string; content: string }>;
  /** Files the authored parser actually RUNS over in the sandbox. Defaults to
   *  `files`; pass the full scanned set here so the parser is never starved by
   *  the prompt-side candidate filter (the filter stops being load-bearing). */
  runtimeFiles?: Array<{ path: string; content: string }>;
  componentNames: Set<string>;
  runAgentFn: (opts: { prompt: string }) => Promise<string>;
  instructionOverride?: string;
  onPhase?: (phase: string) => void;
  timeoutMs?: number;
  /** When true, a parser that runs cleanly but emits ZERO verified edges is
   *  treated as suspicious (the candidate files contain composition markers, so
   *  0 edges usually means a broken parser, not a genuinely flat repo) and gets
   *  one repair round. Off by default so genuinely-empty repos don't pay a
   *  wasted retry. The caller sets it from marker presence in the candidates. */
  retryOnEmpty?: boolean;
}): Promise<ResolveViaParserResult> {
  const warnings: string[] = [];
  const componentNamesArr = [...input.componentNames];
  const ctx = { files: input.runtimeFiles ?? input.files, componentNames: componentNamesArr };

  const verify = (edges: CompositionEdge[]): CompositionEdge[] => {
    const out: CompositionEdge[] = [];
    for (const e of edges) {
      // A component cannot be its own composite parent. Self-edges are a common
      // parser bug (matching a component's own name in its own source) and, left
      // in, masquerade as one-node cycles downstream.
      if (e.parent === e.child) {
        warnings.push(`parser edge dropped: self-edge "${e.parent}→${e.child}"`);
        continue;
      }
      if (!input.componentNames.has(e.parent)) {
        warnings.push(`parser edge dropped: unknown parent "${e.parent}" (${e.parent}→${e.child})`);
        continue;
      }
      if (!input.componentNames.has(e.child)) {
        warnings.push(`parser edge dropped: unknown child "${e.child}" (${e.parent}→${e.child})`);
        continue;
      }
      out.push(e);
    }
    return out;
  };

  // Attempt: author → extract → sandbox. Returns null on a fallback-worthy miss.
  const attempt = async (prompt: string): Promise<{ edges: CompositionEdge[]; source: string } | { error: string }> => {
    input.onPhase?.('authoring');
    const raw = await input.runAgentFn({ prompt });
    const source = extractParserSource(raw);
    if (source === null)
      return { error: 'agent output had no parser-shaped code block (expected `export default function (ctx) {…}`)' };
    input.onPhase?.('parsing');
    const res = await runParserInSandbox(
      source,
      ctx,
      input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {},
    );
    if (res.error) return { error: res.error };
    return { edges: res.edges, source };
  };

  const basePrompt = buildAuthorPrompt(input.files, componentNamesArr, input.instructionOverride);
  const first = await attempt(basePrompt);
  if ('edges' in first) {
    const verified = verify(first.edges);
    // Suspiciously-empty guard: a parser that ran cleanly but emitted no usable
    // edges, when the candidates DO contain composition markers, is almost
    // always broken (wrong parent attribution, wrong pattern). Give it one
    // repair round rather than silently returning nothing.
    if (verified.length > 0 || !input.retryOnEmpty) {
      return { edges: verified, warnings, usedFallback: false, parserSource: first.source };
    }
    warnings.push('parser produced 0 usable edges despite composition markers — retrying once');
    const emptyRepairPrompt = `${basePrompt}\n\nYour previous parser ran without error but returned 0 edges, even though the candidate files clearly contain composition relationships. Re-examine the patterns (parent attribution is the usual culprit) and return only the corrected function in a single fenced code block.`;
    const retry = await attempt(emptyRepairPrompt);
    if ('edges' in retry) {
      const retried = verify(retry.edges);
      // Prefer the retry when it found something; otherwise keep the first
      // parser (it at least ran) rather than discarding a working artifact.
      if (retried.length > 0) {
        return { edges: retried, warnings, usedFallback: false, parserSource: retry.source };
      }
      warnings.push('repair still produced 0 edges — keeping the original parser');
      return { edges: verified, warnings, usedFallback: false, parserSource: first.source };
    }
    warnings.push(`repair attempt failed: ${retry.error} — keeping the original (empty) parser`);
    return { edges: verified, warnings, usedFallback: false, parserSource: first.source };
  }

  // One repair round — tell the agent what went wrong and try again.
  warnings.push(`parser attempt failed: ${first.error} — retrying once`);
  const repairPrompt = `${basePrompt}\n\nYour previous parser failed with: ${first.error}\nFix it and return only the corrected function in a single fenced code block.`;
  const second = await attempt(repairPrompt);
  if ('edges' in second) {
    return { edges: verify(second.edges), warnings, usedFallback: false, parserSource: second.source };
  }

  warnings.push(`parser attempt failed again: ${second.error} — falling back`);
  return { edges: [], warnings, usedFallback: true };
}

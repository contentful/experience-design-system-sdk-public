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
  files: Array<{ path: string; content: string }>;
  componentNames: Set<string>;
  runAgentFn: (opts: { prompt: string }) => Promise<string>;
  instructionOverride?: string;
  onPhase?: (phase: string) => void;
  timeoutMs?: number;
}): Promise<ResolveViaParserResult> {
  const warnings: string[] = [];
  const componentNamesArr = [...input.componentNames];
  const ctx = { files: input.files, componentNames: componentNamesArr };

  const verify = (edges: CompositionEdge[]): CompositionEdge[] => {
    const out: CompositionEdge[] = [];
    for (const e of edges) {
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
    if (source === null) return { error: 'no parser source in agent output' };
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
    return { edges: verify(first.edges), warnings, usedFallback: false, parserSource: first.source };
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

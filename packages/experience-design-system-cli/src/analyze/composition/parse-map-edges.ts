import type { CompositionEdge } from './interchange-schema.js';

/**
 * Lenient JSONL parser for the composition-mapping agent's tool-call output
 * (spec T4). Mirrors `parseSelectToolCallLines` / `parseToolCallLines` in
 * `src/generate/agent-runner.ts`: one JSON object per line, each with a `tool`
 * field from a fixed allowlist. A line that fails JSON.parse or validation is
 * DROPPED into `warnings[]` (with a reason) and parsing CONTINUES — no retry,
 * no throw. Non-`{` prose and blank lines are skipped silently.
 */

export type ParseMapEdgesResult = { edges: CompositionEdge[]; warnings: string[] };

const VALID_MAP_TOOL_NAMES = new Set(['map_edge']);

export function parseMapEdges(raw: string, opts: { componentNames: Set<string> }): ParseMapEdgesResult {
  const edges: CompositionEdge[] = [];
  const warnings: string[] = [];
  const { componentNames } = opts;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;

    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      warnings.push(`unparseable line: ${trimmed.slice(0, 120)}`);
      continue;
    }

    if (typeof obj !== 'object' || obj === null || !('tool' in obj)) continue;
    const rec = obj as Record<string, unknown>;

    if (!VALID_MAP_TOOL_NAMES.has(rec.tool as string)) {
      warnings.push(`unknown tool: ${String(rec.tool)}`);
      continue;
    }

    if (typeof rec.parent !== 'string' || !rec.parent || typeof rec.child !== 'string' || !rec.child) {
      warnings.push('map_edge missing parent/child — skipped');
      continue;
    }

    const { parent, child } = rec;

    // Verification (spec §1.3): both endpoints must name a known component.
    if (!componentNames.has(parent)) {
      warnings.push(`map_edge names unknown component (parent): ${parent} — skipped`);
      continue;
    }
    if (!componentNames.has(child)) {
      warnings.push(`map_edge names unknown component (child): ${child} — skipped`);
      continue;
    }

    const edge: CompositionEdge = { parent, child, provenance: 'agent' };

    if (typeof rec.slot === 'string' && rec.slot) {
      edge.slot = rec.slot;
    }

    if (rec.confidence !== undefined) {
      if (typeof rec.confidence === 'number' && rec.confidence >= 1 && rec.confidence <= 5) {
        edge.confidence = rec.confidence;
      } else {
        // Lenient: keep the edge, drop the bad confidence, record a warning.
        warnings.push(
          `map_edge (${parent}→${child}): invalid confidence ${String(rec.confidence)} — edge kept without confidence`,
        );
      }
    }

    edges.push(edge);
  }

  return { edges, warnings };
}

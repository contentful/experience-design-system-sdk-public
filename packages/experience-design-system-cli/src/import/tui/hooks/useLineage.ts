import { useMemo } from 'react';
import { computeAllClosures, type ComponentGraphNode } from '../../../analyze/composite-closure.js';
import { buildAncestorTree, renderAncestorTree } from '../../../analyze/lineage.js';

/**
 * Shape of a rendered lineage row. Matches ScopeGate's original inline
 * definition byte-for-byte so the extracted hook produces identical entry
 * lists — the M1 ADR-0010 scenario suite pins that behavior.
 */
export type LineageEntry =
  | { kind: 'section'; label: string }
  | { kind: 'ancestor'; label: string; jumpTarget: string }
  | { kind: 'descendant'; label: string; jumpTarget: string }
  | { kind: 'empty'; label: string };

export interface LineageJumpable {
  /** Original index into the `entries` array — callers highlight the source row. */
  i: number;
  entry: LineageEntry;
}

export interface UseLineageResult {
  entries: LineageEntry[];
  /**
   * Jumpable entries — those the operator can Tab/Enter to. Excludes
   * `section` / `empty` rows. Order matches `entries` minus the non-jumpable
   * rows; each item carries the original `entries` index so callers can
   * highlight the source row.
   */
  jumpables: LineageJumpable[];
}

/**
 * Derives the lineage-panel row list for a focused component. Body extracted
 * verbatim from ScopeGateStep's inline `lineageEntries` + `lineageJumpables`
 * memos so both callers (ScopeGate and GenerateReview) share one seam.
 *
 * `focusedKey` may be `null` when nothing is focused — the hook returns empty
 * arrays in that case. `graph` is the unfiltered `ComponentGraphNode[]` per
 * ADR-0010 §Part 1: lineage rendering reads the full structure, not the
 * reject-filtered arm.
 */
export function useLineage(
  focusedKey: string | null,
  graph: ComponentGraphNode[],
): UseLineageResult {
  // L2 (plan §4): callers rebuild `graph` on every render (ScopeGate reloads
  // scope components from the DB upstream, so its `groupedItems`→`graph` memo
  // chain produces a new array identity each render). Gating the memos below
  // on that unstable reference re-derives everything every render, which
  // remounts the lineage panel and makes the banner flash. Collapse the graph
  // to a structural signature and pin a stable reference off it so an
  // equivalent-but-new graph array does NOT invalidate the derived rows.
  // GenerateReview holds its graph in `useState` (stable) and never flashed.
  const graphKey = useMemo(() => JSON.stringify(graph), [graph]);
  const stableGraph = useMemo(() => graph, [graphKey]);

  const closures = useMemo(() => computeAllClosures(stableGraph), [stableGraph]);

  const entries = useMemo<LineageEntry[]>(() => {
    if (!focusedKey) return [];
    const name = focusedKey;
    const tree = buildAncestorTree(name, stableGraph);
    const closure = closures.get(name);
    const out: LineageEntry[] = [];
    out.push({ kind: 'section', label: 'Ancestors:' });
    if (tree.parents.length === 0) {
      out.push({ kind: 'empty', label: '  (no ancestors)' });
    } else {
      const lines = renderAncestorTree(tree);
      for (const line of lines) {
        out.push({
          kind: 'ancestor',
          label: '  ' + line.text,
          jumpTarget: line.jumpTarget ?? name,
        });
      }
    }
    out.push({ kind: 'section', label: 'Descendants:' });
    if (!closure || closure.nodes.length <= 1) {
      out.push({ kind: 'empty', label: '  (none)' });
    } else {
      for (const node of closure.nodes) {
        if (node.name === name) continue;
        out.push({
          kind: 'descendant',
          label: '  ' + '  '.repeat(Math.max(0, node.depth - 1)) + node.name,
          jumpTarget: node.name,
        });
      }
    }
    return out;
  }, [focusedKey, stableGraph, closures]);

  const jumpables = useMemo<LineageJumpable[]>(
    () =>
      entries
        .map((entry, i) => ({ entry, i }))
        .filter(({ entry }) => entry.kind === 'ancestor' || entry.kind === 'descendant'),
    [entries],
  );

  return { entries, jumpables };
}

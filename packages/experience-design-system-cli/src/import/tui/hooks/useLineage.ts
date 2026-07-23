import { useMemo } from 'react';
import { computeAllClosures, type ComponentGraphNode } from '../../../analyze/composite-closure.js';
import { buildAncestorTree, renderAncestorTree } from '../../../analyze/lineage.js';

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

export function useLineage(focusedKey: string | null, graph: ComponentGraphNode[]): UseLineageResult {
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

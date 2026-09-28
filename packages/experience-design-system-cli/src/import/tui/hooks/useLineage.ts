import { useMemo } from 'react';
import { computeAllClosures, type ComponentGraphNode, type Closure } from '../../../analyze/composite-closure.js';
import { buildAncestorTree, type AncestorTreeNode } from '../../../analyze/lineage.js';

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

interface RenderedLine {
  text: string;
  jumpTarget: string;
}

/**
 * Ancestor tree with just component names (no slot labels, no shared/cycle
 * annotations). Uses ├─ / └─ / │ glyphs so parent/sibling/child structure is
 * visible.
 */
function renderCleanAncestorTree(node: AncestorTreeNode): RenderedLine[] {
  const lines: RenderedLine[] = [];
  lines.push({ text: node.name, jumpTarget: node.name });
  const walk = (parents: AncestorTreeNode[], prefix: string): void => {
    for (let i = 0; i < parents.length; i++) {
      const child = parents[i];
      const isLast = i === parents.length - 1;
      const glyph = isLast ? '└─' : '├─';
      lines.push({ text: `${prefix}${glyph} ${child.name}`, jumpTarget: child.name });
      if (child.parents.length > 0) {
        const nextPrefix = prefix + (isLast ? '   ' : '│  ');
        walk(child.parents, nextPrefix);
      }
    }
  };
  walk(node.parents, '');
  return lines;
}

/**
 * Descendant tree from `root` down through slot edges. Renders as an indented
 * tree with ├─ / └─ / │ glyphs — each node appears under its direct parent
 * in the DFS order. `Closure.containsCycle` short-circuits to a flat list to
 * avoid infinite loops.
 */
function renderDescendantTree(root: string, closure: Closure, graph: ComponentGraphNode[]): RenderedLine[] {
  const lines: RenderedLine[] = [];
  if (closure.containsCycle) {
    for (const node of closure.nodes) {
      if (node.name === root) continue;
      lines.push({ text: `  ${node.name}`, jumpTarget: node.name });
    }
    return lines;
  }
  const byName = new Map(graph.map((n) => [n.name, n]));
  const known = new Set(closure.nodes.map((n) => n.name));
  const childrenOf = (name: string): string[] => {
    const node = byName.get(name);
    if (!node) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const slot of node.slots) {
      for (const target of slot.allowedComponents ?? []) {
        if (!known.has(target)) continue;
        if (target === name) continue;
        if (seen.has(target)) continue;
        seen.add(target);
        out.push(target);
      }
    }
    return out.sort((a, b) => a.localeCompare(b));
  };
  const visited = new Set<string>([root]);
  const walk = (parent: string, prefix: string): void => {
    const kids = childrenOf(parent);
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      if (visited.has(child)) continue;
      visited.add(child);
      const isLast = i === kids.length - 1;
      const glyph = isLast ? '└─' : '├─';
      lines.push({ text: `${prefix}${glyph} ${child}`, jumpTarget: child });
      const nextPrefix = prefix + (isLast ? '   ' : '│  ');
      walk(child, nextPrefix);
    }
  };
  walk(root, '');
  return lines;
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
      const lines = renderCleanAncestorTree(tree);
      for (const line of lines) {
        out.push({ kind: 'ancestor', label: '  ' + line.text, jumpTarget: line.jumpTarget ?? name });
      }
    }
    out.push({ kind: 'section', label: 'Descendants:' });
    if (!closure || closure.nodes.length <= 1) {
      out.push({ kind: 'empty', label: '  (none)' });
    } else {
      for (const line of renderDescendantTree(name, closure, stableGraph)) {
        out.push({ kind: 'descendant', label: '  ' + line.text, jumpTarget: line.jumpTarget });
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

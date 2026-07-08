import React from 'react';
import { Box, Text } from 'ink';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import {
  computeAllClosures,
  findSharedDeps,
  type ComponentGraphNode,
  type Closure,
  type NodeStatus,
} from '../../../composite-closure.js';
import type { RenderStatus } from '../../../issue-inheritance.js';
import { previewBadge } from './Sidebar.js';
import type { PreviewAnnotation } from '../../types.js';

/**
 * Composite Components — grouped sidebar renderer.
 *
 * Rendering rules (locked in dsi-composite-components-grouping-spec.md):
 *   Tier order (top → bottom): cycle-rejected → empty → grouped roots → standalones.
 *   Roots with ≥1 dep render as `▸ Name (N deps)` collapsed, `▾ Name (N deps)` expanded.
 *   Children indent with `├─` / `└─` at every depth — no truncation. Every
 *     descendant renders on its own row so the operator sees the full tree.
 *     Aggressive per-group collapse (via `expandedGroups`) remains the sole
 *     lever for hiding subtrees; the caller can wire expand-all / collapse-all
 *     shortcuts on top of that.
 *   Aggregate status: worst-case glyph only (`✗` beats `⚠` beats none) on collapsed row.
 *   Shared deps: render under every root, with a dim `(shared)` marker on 2nd+ occurrence.
 *   Zero-dep components that are also not a dep of anyone → standalone tier (flat row).
 */

export interface GroupedSidebarItem {
  key: string;
  entry: CDFComponentEntry;
  /**
   * Per-node validation status used for aggregate roll-up on collapsed group rows.
   * Callers translate their review/validation state into this coarse tri-state.
   */
  status: NodeStatus;
}

export interface GroupedSidebarProps {
  items: GroupedSidebarItem[];
  cycleParticipants?: Set<string>;
  selectedIdx: number;
  /**
   * Visible-row cursor index. When provided, this takes precedence over
   * `selectedIdx` for determining which row renders as selected. Required
   * whenever `items` may produce multiple rows for the same item (shared
   * deps under multiple parents, or `showFlatTier`), since `selectedIdx` on
   * its own draws EVERY row with a matching itemIdx as selected — causing
   * the cursor to appear in multiple places and navigation to snap back to
   * the first occurrence. See INTEG-4411 grouped-sidebar duplicate-cursor fix.
   */
  selectedRowIdx?: number;
  onSelect: (idx: number) => void;
  expandedGroups: Set<string>;
  onToggleExpanded: (rootName: string) => void;
  width: number;
  focused: boolean;
  /**
   * Optional issue-inheritance render statuses keyed by component name.
   * When present, rows render a status glyph (⚠/✗) after their label. Rows
   * whose entry has `isOwn: true` render in a bright color; `isOwn: false`
   * (i.e., inherited from a descendant) render dimmed.
   */
  renderStatusByKey?: Map<string, RenderStatus>;
  /**
   * Optional preview-diff annotation keyed by component name. When present,
   * a one-character badge is reserved in the column between the status glyph
   * and the row label. Preserves the flat-Sidebar behavior so live-preview
   * annotations don't disappear under grouping.
   */
  previewAnnotationByKey?: Map<string, PreviewAnnotation>;
  /**
   * Optional scroll offset. When provided together with `visibleCount`, the
   * component renders a windowed slice of the flat visible-row list and
   * surfaces up/down scroll arrows (▲/▼) when content lies outside the
   * window. Omit to render every row (test-friendly default).
   */
  scrollOffset?: number;
  visibleCount?: number;
  /** When true, force every group open regardless of expandedGroups. */
  alwaysExpanded?: boolean;
  /**
   * When true, append a flat "All components" tier below the standalone tier
   * listing every non-empty, non-cycle component once (roots + children +
   * standalones), alphabetical. Each row is selectable via its own itemIdx.
   */
  showFlatTier?: boolean;
  /**
   * Per-source-component selection state. When provided, rows that resolve to
   * a ComponentType render a leading glyph (`[✓]` / `[✗]` / `[ ]`). Applies
   * to standalone, group-root, group-child, and flat rows only.
   */
  selectionStateByKey?: Map<string, 'accepted' | 'rejected' | 'undecided'>;
  /**
   * Optional per-source-component AI-flagged marker. When present, rows whose
   * key maps to `true` render a dedicated 3-char `[×]` glyph in bright yellow
   * in a reserved column between the user's selection glyph and the label
   * (rows that map to `false` or are absent render a 3-space placeholder so
   * labels stay column-aligned). This is deliberately separate from the
   * user's own `[✓]`/`[✗]` decision glyph so the AI's suggestion is legible
   * at a glance without being confused with the user's own choice.
   */
  aiFlaggedByKey?: Map<string, boolean>;
  /**
   * Optional predicate over the row's underlying component key. When it
   * returns true, the row's label renders dim. Group-root rows never dim
   * (tree structure must remain findable). Cycle rows never dim.
   */
  dimPredicate?: (componentKey: string) => boolean;
  /**
   * View mode for the Column-1 render. `'grouped'` (default) uses the tiered
   * cycle/empty/grouped-roots/standalone layout. `'large-list'` emits a
   * cycles-first, otherwise-alphabetical flat list of every component with a
   * `(N deps)` suffix on composite roots. Only `buildVisibleRows` observes this
   * flag — every downstream decoration (cursor, selection glyph, AI badge,
   * dim, cycle color) is row-kind-driven and unchanged.
   */
  viewMode?: 'grouped' | 'large-list';
  /**
   * Optional precomputed visible-row list. When provided, GroupedSidebar
   * renders these rows directly and skips its internal `buildVisibleRows`
   * call. Callers that already memoize the row list (e.g. ScopeGateStep,
   * GenerateReviewStep) pass their memoized array in to avoid recomputing
   * the same rows on every render. When omitted, GroupedSidebar falls back
   * to computing rows from `items` / `cycleParticipants` / etc.
   */
  visibleRows?: VisibleRow[];
}

const GLYPH_EXPAND_COLLAPSED = '▸';
const GLYPH_EXPAND_EXPANDED = '▾';
const GLYPH_TREE_MID = '├─';
const GLYPH_TREE_LAST = '└─';
const GLYPH_WARN = '⚠';
const GLYPH_ERROR = '✗';

type RowKind =
  | 'cycle'
  | 'empty'
  | 'group-root'
  | 'group-child'
  | 'standalone'
  | 'flat'
  | 'flat-header';

export interface VisibleRow {
  kind: RowKind;
  key: string;
  label: string;
  indent: number;
  /** For group-root rows: the aggregate status glyph (or null). */
  aggregateGlyph?: string | null;
  /** For group-child rows: whether the item is a shared dep occurring the 2nd+ time. */
  sharedSuffix?: boolean;
  /**
   * For group-child rows only: true when the child is a cycle-participant
   * reachable via a slot from a composite in the closure. Renders red with a
   * `⚠ ` prefix and `(cycle)` suffix in its label, but keeps `kind: 'group-child'`
   * so selection/AI/preview decoration paths stay unchanged.
   */
  cycleChild?: boolean;
  /** Selectable index into `items`; -1 for synthetic rows (e.g. flat-header). */
  itemIdx: number;
  /** Root name — for children/roots, so the caller can toggle via row. */
  rootName?: string;
}

/** True when a component has zero classifiable props and zero slots. */
function isEmpty(entry: CDFComponentEntry): boolean {
  return (
    Object.keys(entry.$properties ?? {}).length === 0 &&
    Object.keys(entry.$slots ?? {}).length === 0
  );
}

function itemsToGraph(items: GroupedSidebarItem[]): ComponentGraphNode[] {
  return items.map((it) => ({
    name: it.key,
    slots: Object.entries(it.entry.$slots ?? {}).map(([slotName, slotDef]) => ({
      name: slotName,
      allowedComponents: Array.isArray(slotDef?.$allowedComponents)
        ? (slotDef.$allowedComponents as unknown[]).filter((v): v is string => typeof v === 'string')
        : [],
    })),
  }));
}

function aggregateGlyphFor(
  closure: Closure,
  statusByName: Map<string, NodeStatus>,
): string | null {
  let worst: NodeStatus = 'ok';
  for (const node of closure.nodes) {
    const s = statusByName.get(node.name);
    if (!s) continue;
    if (s === 'error') {
      worst = 'error';
      break;
    }
    if (s === 'warning') worst = 'warning';
  }
  if (worst === 'error') return GLYPH_ERROR;
  if (worst === 'warning') return GLYPH_WARN;
  return null;
}

/**
 * Build the flat, in-order list of visible rows.
 *
 * The function is pure and export-visible for testing — the render layer only
 * decides colors/selection styling from these rows.
 */
export function buildVisibleRows(props: {
  items: GroupedSidebarItem[];
  cycleParticipants: Set<string>;
  expandedGroups: Set<string>;
  alwaysExpanded?: boolean;
  showFlatTier?: boolean;
  viewMode?: 'grouped' | 'large-list';
}): VisibleRow[] {
  const { items, cycleParticipants, alwaysExpanded, showFlatTier, viewMode } = props;

  if (viewMode === 'large-list') {
    // Cycles-first (alphabetical), then all remaining components alphabetical.
    // One row per component; no group nesting, no `(shared)` markers. Composite
    // roots get a `(N deps)` suffix so the density hint from Column-3 carries
    // over. Every row is a `flat` kind so selection-glyph / AI-badge / dim
    // logic on the render side lights up unchanged.
    const rows: VisibleRow[] = [];
    if (items.length === 0) return rows;
    const itemByKey = new Map(items.map((it, idx) => [it.key, { it, idx }]));
    const cycleKeys: string[] = [];
    const otherKeys: string[] = [];
    for (const it of items) {
      if (cycleParticipants.has(it.key)) cycleKeys.push(it.key);
      else otherKeys.push(it.key);
    }
    cycleKeys.sort();
    otherKeys.sort();
    // Compute closures over the non-cycle subgraph so we can annotate composite
    // roots with dep counts. Cycle participants never anchor a closure here —
    // they're rendered with the cycle glyph and no suffix.
    const otherItems = items.filter((it) => otherKeys.includes(it.key));
    const closures = computeAllClosures(itemsToGraph(otherItems));
    const depCountByKey = new Map<string, number>();
    for (const [name, closure] of closures) {
      if (closure.nodes.length > 1) depCountByKey.set(name, closure.nodes.length - 1);
    }
    for (const key of cycleKeys) {
      const rec = itemByKey.get(key);
      if (!rec) continue;
      rows.push({
        kind: 'cycle',
        key: `cycle:${key}`,
        label: `${GLYPH_WARN} ${key} (cycle)`,
        indent: 0,
        itemIdx: rec.idx,
      });
    }
    for (const key of otherKeys) {
      const rec = itemByKey.get(key);
      if (!rec) continue;
      const dep = depCountByKey.get(key);
      const suffix = dep !== undefined ? ` (${dep} dep${dep === 1 ? '' : 's'})` : '';
      rows.push({
        kind: 'flat',
        key: `flat:${key}`,
        label: `${key}${suffix}`,
        indent: 0,
        itemIdx: rec.idx,
      });
    }
    return rows;
  }

  const rows: VisibleRow[] = [];
  if (items.length === 0) return rows;

  const itemByKey = new Map(items.map((it, idx) => [it.key, { it, idx }]));
  const statusByName = new Map(items.map((it) => [it.key, it.status]));

  // Tier 1: cycle participants (flat rows at top, alphabetical).
  const cycleKeys: string[] = [];
  // Tier 2: empty components (not in cycle).
  const emptyKeys: string[] = [];
  // Everything else is a candidate for grouping or standalone tier.
  const otherKeys: string[] = [];

  for (const it of items) {
    if (cycleParticipants.has(it.key)) cycleKeys.push(it.key);
    else if (isEmpty(it.entry)) emptyKeys.push(it.key);
    else otherKeys.push(it.key);
  }

  cycleKeys.sort();
  emptyKeys.sort();

  // Track cycle-child occurrences ACROSS the cycle-tier subtrees so a member
  // slotted by multiple cycle-tier parents picks up `(shared)` on 2nd+.
  const seenCycleTierChildOccurrence = new Set<string>();

  /**
   * Local subtree walker for a cycle-tier root. `computeAllClosures` collapses
   * cyclic closures to `[root]`, so we can't reuse the grouped-roots walker.
   * BFS from `root` through slot edges, stopping at back-edges (visited seed
   * includes root itself). Nodes reached via a back-edge are still emitted
   * once as a leaf so the operator can see the closure boundary.
   */
  const computeCycleMemberSubtree = (
    root: string,
  ): Array<{ name: string; depth: number; isCycleMember: boolean }> => {
    const out: Array<{ name: string; depth: number; isCycleMember: boolean }> = [];
    const visited = new Set<string>([root]);
    const queue: Array<{ name: string; depth: number }> = [{ name: root, depth: 0 }];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const parentItem = itemByKey.get(cur.name)?.it;
      if (!parentItem) continue;
      const slotTargets: string[] = [];
      const seenTarget = new Set<string>();
      for (const slot of Object.values(parentItem.entry.$slots ?? {})) {
        const allowed = Array.isArray(slot?.$allowedComponents)
          ? (slot.$allowedComponents as unknown[]).filter((v): v is string => typeof v === 'string')
          : [];
        for (const target of allowed) {
          if (!itemByKey.has(target)) continue;
          if (seenTarget.has(target)) continue;
          seenTarget.add(target);
          slotTargets.push(target);
        }
      }
      slotTargets.sort();
      for (const target of slotTargets) {
        if (visited.has(target)) continue;
        visited.add(target);
        const isCycleMember = cycleParticipants.has(target);
        out.push({ name: target, depth: cur.depth + 1, isCycleMember });
        // Continue descent unless this is a cycle back-edge into the root.
        // BFS through target for its own slots — but if target itself is a
        // cycle participant and slotting it would loop back to root, we still
        // add it once (already done above) and BFS naturally terminates via
        // the `visited` guard when a back-edge is revisited.
        queue.push({ name: target, depth: cur.depth + 1 });
      }
    }
    return out;
  };

  for (const key of cycleKeys) {
    const rec = itemByKey.get(key);
    if (!rec) continue;
    const expanded = alwaysExpanded ? true : props.expandedGroups.has(key);
    const glyphExpand = expanded ? GLYPH_EXPAND_EXPANDED : GLYPH_EXPAND_COLLAPSED;
    rows.push({
      kind: 'cycle',
      key: `cycle:${key}`,
      label: `${glyphExpand} ${GLYPH_WARN} ${key} (cycle)`,
      indent: 0,
      itemIdx: rec.idx,
      rootName: key,
    });
    if (!expanded) continue;
    const subtree = computeCycleMemberSubtree(key);
    subtree.forEach((child, i) => {
      const isLast = i === subtree.length - 1;
      const glyph = isLast ? GLYPH_TREE_LAST : GLYPH_TREE_MID;
      let sharedSuffix = false;
      if (seenCycleTierChildOccurrence.has(child.name)) sharedSuffix = true;
      else seenCycleTierChildOccurrence.add(child.name);
      const childRec = itemByKey.get(child.name);
      const indent = '  '.repeat(Math.max(0, child.depth - 1));
      const labelName = child.isCycleMember
        ? `${GLYPH_WARN} ${child.name} (cycle)`
        : child.name;
      rows.push({
        kind: 'group-child',
        key: `cycle-child:${key}:${child.name}`,
        label: `${indent}${glyph} ${labelName}${sharedSuffix ? ' (shared)' : ''}`,
        indent: child.depth,
        sharedSuffix,
        cycleChild: child.isCycleMember || undefined,
        itemIdx: childRec?.idx ?? -1,
        rootName: key,
      });
    });
  }
  for (const key of emptyKeys) {
    const rec = itemByKey.get(key);
    if (!rec) continue;
    rows.push({
      kind: 'empty',
      key: `empty:${key}`,
      label: `${key} (empty)`,
      indent: 0,
      itemIdx: rec.idx,
    });
  }

  // Compute closures over the "other" scope only (cycle-participants and empty
  // components live in their own flat tiers and never anchor a group).
  const otherItems = items.filter((it) => otherKeys.includes(it.key));
  const graph = itemsToGraph(otherItems);
  const closures = computeAllClosures(graph);
  const sharedDeps = findSharedDeps(closures);

  // Detect cycle-member slot references for every candidate item. A composite
  // whose slots point at a cycle-participant needs to render that participant
  // as a `⚠ (cycle)` child — even if the composite has no other (non-cycle)
  // deps, in which case the composite is still shown as a group-root, not a
  // standalone. We compute this map once and consult it during (a) root
  // categorization and (b) the cycle-child injection walk further below.
  const hasCycleDepDirect = (name: string): boolean => {
    const it = itemByKey.get(name)?.it;
    if (!it) return false;
    for (const slot of Object.values(it.entry.$slots ?? {})) {
      const allowed = Array.isArray(slot?.$allowedComponents)
        ? (slot.$allowedComponents as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      for (const target of allowed) {
        if (cycleParticipants.has(target)) return true;
      }
    }
    return false;
  };

  // Split "other" into standalones vs group-roots.
  // A standalone: closure has exactly 1 node (itself) AND it slots no cycle
  // participants. A group-root: closure size > 1 OR the root slots at least
  // one cycle participant (which will be injected as a `⚠ (cycle)` child).
  const rootNames = [...closures.keys()].sort();
  const standaloneRoots: string[] = [];
  const groupRoots: string[] = [];
  for (const root of rootNames) {
    const c = closures.get(root)!;
    const promotesForCycle = hasCycleDepDirect(root);
    if (c.nodes.length <= 1 && !promotesForCycle) standaloneRoots.push(root);
    else groupRoots.push(root);
  }

  // Track shared-dep occurrences so we can decorate the 2nd+ occurrence.
  const seenSharedOccurrence = new Set<string>();
  // Track cycle-member injection occurrences across every group so a cycle
  // member slotted by multiple composites picks up the same `(shared)`
  // decoration on its 2nd+ occurrence (findSharedDeps only sees the non-cycle
  // subgraph, so cycle members never surface through it).
  const seenCycleChildOccurrence = new Set<string>();

  for (const root of groupRoots) {
    const closure = closures.get(root)!;
    // Count cycle-member injections across the root + every closure node so
    // the collapsed dep count matches what the user will see when they expand.
    let injectedCycleCount = 0;
    const seenInject = new Set<string>();
    const countInjections = (parentName: string): void => {
      const parentItem = itemByKey.get(parentName)?.it;
      if (!parentItem) return;
      for (const slot of Object.values(parentItem.entry.$slots ?? {})) {
        const allowed = Array.isArray(slot?.$allowedComponents)
          ? (slot.$allowedComponents as unknown[]).filter((v): v is string => typeof v === 'string')
          : [];
        for (const target of allowed) {
          if (!cycleParticipants.has(target)) continue;
          const key = `${parentName}→${target}`;
          if (seenInject.has(key)) continue;
          seenInject.add(key);
          injectedCycleCount += 1;
        }
      }
    };
    countInjections(root);
    for (const n of closure.nodes) if (n.name !== root) countInjections(n.name);
    const depCount = (closure.nodes.length - 1) + injectedCycleCount;
    const expanded = alwaysExpanded ? true : props.expandedGroups.has(root);
    const glyphExpand = expanded ? GLYPH_EXPAND_EXPANDED : GLYPH_EXPAND_COLLAPSED;
    const aggregate = expanded ? null : aggregateGlyphFor(closure, statusByName);
    const rec = itemByKey.get(root)!;
    rows.push({
      kind: 'group-root',
      key: `root:${root}`,
      label: `${glyphExpand} ${root} (${depCount} dep${depCount === 1 ? '' : 's'})${aggregate ? ' ' + aggregate : ''}`,
      indent: 0,
      aggregateGlyph: aggregate,
      itemIdx: rec.idx,
      rootName: root,
    });

    if (!expanded) continue;

    // Sort children by (depth asc, name asc) — same order composite-closure
    // returns them, minus the root itself. Every descendant renders; there is
    // no depth cap and no `+N more` overflow row. Users manage visual density
    // via per-group collapse (`expandedGroups`).
    //
    // Cycle-injection: closure computation runs over the non-cycle subgraph
    // (cycle-participants are excluded so `computeClosure` doesn't collapse
    // the subtree to `containsCycle: true`). But cycle members can still be
    // slotted BY composites in the closure — and the operator needs to see
    // them under those parents. So after collecting the closure's own
    // children, we scan each closure node's original slots for cycle-member
    // references and inject them as leaf children at `parent.depth + 1`.
    const closureChildren = closure.nodes
      .filter((n) => n.name !== root)
      .slice()
      .sort((a, b) => (a.depth - b.depth) || a.name.localeCompare(b.name));

    // Build ordered child list, weaving in cycle-member leaves under each
    // parent that slots them (including the root itself).
    type ChildRow = {
      name: string;
      depth: number;
      isCycleChild: boolean;
    };
    const injectedChildren: ChildRow[] = [];
    const emitCycleChildrenOf = (parentName: string, parentDepth: number): void => {
      const parentItem = itemByKey.get(parentName)?.it;
      if (!parentItem) return;
      const seen = new Set<string>();
      for (const slot of Object.values(parentItem.entry.$slots ?? {})) {
        const allowed = Array.isArray(slot?.$allowedComponents)
          ? (slot.$allowedComponents as unknown[]).filter((v): v is string => typeof v === 'string')
          : [];
        for (const target of allowed) {
          if (!cycleParticipants.has(target)) continue;
          if (seen.has(target)) continue;
          seen.add(target);
          injectedChildren.push({
            name: target,
            depth: parentDepth + 1,
            isCycleChild: true,
          });
        }
      }
    };
    // Root's own cycle-member slots first (they render at depth 1).
    emitCycleChildrenOf(root, 0);
    for (const c of closureChildren) {
      injectedChildren.push({ name: c.name, depth: c.depth, isCycleChild: false });
      emitCycleChildrenOf(c.name, c.depth);
    }

    injectedChildren.forEach((child, i) => {
      const isLast = i === injectedChildren.length - 1;
      const glyph = isLast ? GLYPH_TREE_LAST : GLYPH_TREE_MID;
      let sharedSuffix = false;
      if (child.isCycleChild) {
        if (seenCycleChildOccurrence.has(child.name)) sharedSuffix = true;
        else seenCycleChildOccurrence.add(child.name);
      } else if (sharedDeps.has(child.name)) {
        if (seenSharedOccurrence.has(child.name)) sharedSuffix = true;
        else seenSharedOccurrence.add(child.name);
      }
      const childRec = itemByKey.get(child.name);
      const indent = '  '.repeat(Math.max(0, child.depth - 1));
      const labelName = child.isCycleChild
        ? `${GLYPH_WARN} ${child.name} (cycle)`
        : child.name;
      rows.push({
        kind: 'group-child',
        key: `child:${root}:${child.name}`,
        label: `${indent}${glyph} ${labelName}${sharedSuffix ? ' (shared)' : ''}`,
        indent: child.depth,
        sharedSuffix,
        cycleChild: child.isCycleChild || undefined,
        itemIdx: childRec?.idx ?? -1,
        rootName: root,
      });
    });
  }

  // Tier 4: standalones (bottom, alphabetical).
  for (const name of standaloneRoots) {
    const rec = itemByKey.get(name);
    if (!rec) continue;
    rows.push({
      kind: 'standalone',
      key: `stand:${name}`,
      label: name,
      indent: 0,
      itemIdx: rec.idx,
    });
  }

  // Tier 5: optional flat "All components" tier — every non-empty, non-cycle
  // component once, alphabetical. Shared deps appear exactly once here.
  if (showFlatTier) {
    const flatNames = otherKeys.slice().sort();
    if (flatNames.length > 0) {
      rows.push({
        kind: 'flat-header',
        key: 'flat-header',
        label: '── All components ──',
        indent: 0,
        itemIdx: -1,
      });
      for (const name of flatNames) {
        const rec = itemByKey.get(name);
        if (!rec) continue;
        rows.push({
          kind: 'flat',
          key: `flat:${name}`,
          label: name,
          indent: 0,
          itemIdx: rec.idx,
        });
      }
    }
  }

  return rows;
}

/**
 * Returns the selectable item indices in the exact order rows are rendered.
 * Callers implementing ↑/↓/j/k navigation must step selection through this
 * order — stepping through the raw `items[]` order will skip rows that live
 * in a different tier or expanded group.
 */
export function visibleItemOrder(props: {
  items: GroupedSidebarItem[];
  cycleParticipants: Set<string>;
  expandedGroups: Set<string>;
  alwaysExpanded?: boolean;
  showFlatTier?: boolean;
}): number[] {
  return buildVisibleRows(props)
    .filter((row) => row.itemIdx >= 0)
    .map((row) => row.itemIdx);
}

/**
 * Row color heuristic. Cycle rows are red (blocking); empty rows yellow
 * (advisory); everything else defaults to `undefined` so Ink renders the row
 * in the terminal's default fg — matches the existing flat Sidebar.tsx.
 */
function rowColor(row: VisibleRow, aggregate?: string | null): string | undefined {
  if (row.kind === 'cycle') return 'red';
  if (row.kind === 'group-child' && row.cycleChild) return 'red';
  if (row.kind === 'empty') return 'yellow';
  if (row.kind === 'group-root' && aggregate === GLYPH_ERROR) return 'red';
  if (row.kind === 'group-root' && aggregate === GLYPH_WARN) return 'yellow';
  return undefined;
}

/**
 * Compute the label styling for a row. When the cursor is on the row, the
 * cursor-here affordance overrides all row-kind coloring/dim: the label
 * renders in bold white regardless of whether the row is a cycle (red),
 * an aggregate-warning root (yellow), a shared-suffix child (dim), or a
 * `dimPredicate` match (dim). This makes "you are here" unambiguous on
 * every row kind — the ▶ glyph alone competes with red/yellow row colors
 * and inverse-video, so we drop those on the cursor row.
 *
 * Exported for tests; the render loop consumes it directly.
 */
export function labelStyleFor(input: {
  row: VisibleRow;
  isCursor: boolean;
  wouldDim: boolean;
}): { color: string | undefined; bold: boolean; dim: boolean } {
  const { row, isCursor, wouldDim } = input;
  if (isCursor) {
    return { color: 'white', bold: true, dim: false };
  }
  return {
    color: rowColor(row, row.aggregateGlyph),
    bold: false,
    dim: wouldDim,
  };
}

export function GroupedSidebar(props: GroupedSidebarProps): React.ReactElement {
  const {
    items,
    cycleParticipants = new Set(),
    expandedGroups,
    focused,
    width,
    selectedIdx,
    selectedRowIdx,
    renderStatusByKey,
    previewAnnotationByKey,
    scrollOffset,
    visibleCount,
    alwaysExpanded,
    showFlatTier,
    viewMode,
    selectionStateByKey,
    aiFlaggedByKey,
    dimPredicate,
    visibleRows: providedRows,
  } = props;
  const allRows =
    providedRows ??
    buildVisibleRows({
      items,
      cycleParticipants,
      expandedGroups,
      alwaysExpanded,
      showFlatTier,
      viewMode,
    });

  // Window rows when scrollOffset+visibleCount are provided; otherwise render
  // the full list. Arrow indicators mirror the flat Sidebar behavior.
  const windowed = scrollOffset !== undefined && visibleCount !== undefined;
  const start = windowed ? Math.max(0, scrollOffset ?? 0) : 0;
  const end = windowed ? start + (visibleCount ?? allRows.length) : allRows.length;
  const rows = windowed ? allRows.slice(start, end) : allRows;
  const showScrollUp = windowed && start > 0;
  const showScrollDown = windowed && end < allRows.length;

  return (
    <Box
      flexDirection="column"
      width={width}
      flexShrink={0}
      borderStyle="single"
      borderColor={focused ? 'white' : undefined}
    >
      {showScrollUp && <Text dimColor>▲</Text>}
      {rows.map((row, i) => {
        // When `selectedRowIdx` is provided, use it as the sole source of
        // truth so exactly one row is highlighted — even when the same
        // itemIdx appears on multiple rows (shared deps under multiple
        // parents, flat-tier + grouped occurrences, etc.). Fall back to
        // itemIdx matching only when the caller hasn't opted in.
        const absoluteRowIdx = start + i;
        const isSelected =
          selectedRowIdx !== undefined
            ? absoluteRowIdx === selectedRowIdx && row.itemIdx >= 0
            : row.itemIdx >= 0 && row.itemIdx === selectedIdx;
        // baseColor kept for potential fallbacks; labelStyleFor is the source of truth.
        // Look up per-row inheritance status + preview annotation by the
        // component name this row represents (synthetic rows like the flat-
        // tier header have itemIdx < 0 and never carry decorations).
        const itemName = row.itemIdx >= 0 ? items[row.itemIdx]?.key : undefined;
        const rs = itemName ? renderStatusByKey?.get(itemName) : undefined;
        const badge = itemName ? previewBadge(previewAnnotationByKey?.get(itemName)) : null;
        // Suppress inheritance glyph on rows that already have a semantic
        // marker: cycle rows carry their own ⚠, empty rows are advisory-only,
        // and group-root rows use `aggregateGlyph` (own roll-up path).
        const showInheritance =
          rs !== undefined &&
          row.kind !== 'cycle' &&
          row.kind !== 'empty' &&
          row.kind !== 'group-root';
        const inheritanceGlyph =
          showInheritance && rs
            ? rs.status === 'error'
              ? GLYPH_ERROR
              : rs.status === 'warning'
                ? GLYPH_WARN
                : null
            : null;
        const inheritanceColor = rs
          ? rs.status === 'error'
            ? 'red'
            : rs.status === 'warning'
              ? 'yellow'
              : undefined
          : undefined;
        const inheritanceDim = rs ? !rs.isOwn : false;

        // Selection glyph applies to component-backed rows only. Cycle rows
        // are included: cycle members are selectable in the manifest push, so
        // hiding their user-decision state on a red row is a bug — the glyph
        // renders in bright white to stay legible against the red row color.
        const supportsSelectionGlyph =
          selectionStateByKey !== undefined &&
          itemName !== undefined &&
          (row.kind === 'standalone' ||
            row.kind === 'group-root' ||
            row.kind === 'group-child' ||
            row.kind === 'flat' ||
            row.kind === 'cycle');
        const selState = supportsSelectionGlyph
          ? selectionStateByKey!.get(itemName!) ?? 'undecided'
          : undefined;
        const isCycleRow = row.kind === 'cycle';
        let selGlyph: string | null = null;
        let selColor: string | undefined;
        let selDim = false;
        let selBold = false;
        if (selState === 'accepted') {
          selGlyph = '[✓]';
          selColor = isCycleRow ? 'white' : 'green';
          selBold = isCycleRow;
        } else if (selState === 'rejected') {
          selGlyph = '[✗]';
          selColor = isCycleRow ? 'white' : 'red';
          selBold = isCycleRow;
        } else if (selState === 'undecided') {
          selGlyph = '[ ]';
          selDim = !isCycleRow;
          selColor = isCycleRow ? 'white' : undefined;
        }

        const aiFlagged =
          aiFlaggedByKey !== undefined &&
          itemName !== undefined &&
          row.kind !== 'flat-header' &&
          aiFlaggedByKey.get(itemName) === true;

        const canDim =
          dimPredicate !== undefined &&
          itemName !== undefined &&
          row.kind !== 'cycle' &&
          row.kind !== 'group-root' &&
          row.kind !== 'flat-header' &&
          dimPredicate(itemName);

        const isSynthetic = row.kind === 'flat-header';
        const isCursor = isSelected && focused;
        const wouldDim =
          row.kind === 'flat-header' ||
          row.sharedSuffix === true ||
          canDim;
        const labelStyle = labelStyleFor({ row, isCursor, wouldDim });

        return (
          <Box key={row.key}>
            {isCursor ? (
              <Text color="cyan" bold>
                {'▶'}
              </Text>
            ) : (
              // Reserve the cursor-glyph column so labels stay column-aligned
              // as the cursor moves through the list.
              <Text> </Text>
            )}
            {badge ? (
              <Text color={badge.color} bold={badge.bold} dimColor={badge.dim}>
                {badge.char}
              </Text>
            ) : (
              // Reserve the badge column so row widths stay stable as
              // annotations flip in/out — matches the flat Sidebar.
              <Text> </Text>
            )}
            {selectionStateByKey !== undefined && (
              selGlyph && !isSynthetic ? (
                <Text color={selColor} dimColor={selDim} bold={selBold}>
                  {' ' + selGlyph}
                </Text>
              ) : (
                // Reserve the 4-char slot ("[ ] " width) so labels stay
                // column-aligned across every row (including rows that don't
                // themselves carry a selection glyph).
                <Text>{'    '}</Text>
              )
            )}
            {aiFlaggedByKey !== undefined && (
              aiFlagged ? (
                <Text color="yellow" bold>
                  {' [×]'}
                </Text>
              ) : (
                // Reserve the 4-char slot ("[×] " width) so labels stay
                // column-aligned when the AI has no opinion on the row.
                <Text>{'    '}</Text>
              )
            )}
            <Text
              color={labelStyle.color}
              bold={labelStyle.bold}
              inverse={isSelected && focused}
              underline={isSelected && !focused}
              dimColor={labelStyle.dim}
              wrap="truncate"
            >
              {' '}
              {row.label}
            </Text>
            {inheritanceGlyph && (
              <Text
                color={isCursor ? 'white' : inheritanceColor}
                bold={isCursor}
                dimColor={!isCursor && inheritanceDim}
              >
                {' ' + inheritanceGlyph}
              </Text>
            )}
          </Box>
        );
      })}
      {showScrollDown && <Text dimColor>▼</Text>}
    </Box>
  );
}

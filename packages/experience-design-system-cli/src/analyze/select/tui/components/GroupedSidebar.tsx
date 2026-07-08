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
 *   Children indent with `├─` / `└─`; depth capped at 2 levels, overflow → `+N more`.
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
  /** Optional per-source-component AI-flagged marker. Trailing dim ` *`. */
  aiFlaggedByKey?: Map<string, boolean>;
  /**
   * Optional predicate over the row's underlying component key. When it
   * returns true, the row's label renders dim. Group-root rows never dim
   * (tree structure must remain findable). Cycle rows never dim.
   */
  dimPredicate?: (componentKey: string) => boolean;
}

const GLYPH_EXPAND_COLLAPSED = '▸';
const GLYPH_EXPAND_EXPANDED = '▾';
const GLYPH_TREE_MID = '├─';
const GLYPH_TREE_LAST = '└─';
const GLYPH_WARN = '⚠';
const GLYPH_ERROR = '✗';
const DEPTH_CAP = 2;

type RowKind =
  | 'cycle'
  | 'empty'
  | 'group-root'
  | 'group-child'
  | 'group-more'
  | 'standalone'
  | 'flat'
  | 'flat-header';

interface VisibleRow {
  kind: RowKind;
  key: string;
  label: string;
  indent: number;
  /** For group-root rows: the aggregate status glyph (or null). */
  aggregateGlyph?: string | null;
  /** For group-child rows: whether the item is a shared dep occurring the 2nd+ time. */
  sharedSuffix?: boolean;
  /** Selectable index into `items`; -1 for synthetic rows (e.g. `+N more`). */
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
}): VisibleRow[] {
  const { items, cycleParticipants, alwaysExpanded, showFlatTier } = props;
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

  // Split "other" into standalones vs group-roots.
  // A standalone: closure has exactly 1 node (itself) AND it is not a dep of
  // any other root's closure. A group-root: closure size > 1.
  const rootNames = [...closures.keys()].sort();
  const standaloneRoots: string[] = [];
  const groupRoots: string[] = [];
  for (const root of rootNames) {
    const c = closures.get(root)!;
    if (c.nodes.length <= 1) standaloneRoots.push(root);
    else groupRoots.push(root);
  }

  // Track shared-dep occurrences so we can decorate the 2nd+ occurrence.
  const seenSharedOccurrence = new Set<string>();

  for (const root of groupRoots) {
    const closure = closures.get(root)!;
    const depCount = closure.nodes.length - 1;
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
    // returns them, minus the root itself. Apply depth cap.
    const children = closure.nodes
      .filter((n) => n.name !== root)
      .slice()
      .sort((a, b) => (a.depth - b.depth) || a.name.localeCompare(b.name));

    const inCap = children.filter((n) => n.depth <= DEPTH_CAP);
    const overflow = children.length - inCap.length;

    inCap.forEach((child, i) => {
      const isLast = i === inCap.length - 1 && overflow === 0;
      const glyph = isLast ? GLYPH_TREE_LAST : GLYPH_TREE_MID;
      const shared = sharedDeps.has(child.name);
      let sharedSuffix = false;
      if (shared) {
        if (seenSharedOccurrence.has(child.name)) sharedSuffix = true;
        else seenSharedOccurrence.add(child.name);
      }
      const childRec = itemByKey.get(child.name);
      rows.push({
        kind: 'group-child',
        key: `child:${root}:${child.name}`,
        label: `${'  '.repeat(child.depth - 1)}${glyph} ${child.name}${sharedSuffix ? ' (shared)' : ''}`,
        indent: child.depth,
        sharedSuffix,
        itemIdx: childRec?.idx ?? -1,
        rootName: root,
      });
    });

    if (overflow > 0) {
      rows.push({
        kind: 'group-more',
        key: `more:${root}`,
        label: `  ${GLYPH_TREE_LAST} +${overflow} more`,
        indent: 1,
        itemIdx: -1,
        rootName: root,
      });
    }
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
  if (row.kind === 'empty') return 'yellow';
  if (row.kind === 'group-root' && aggregate === GLYPH_ERROR) return 'red';
  if (row.kind === 'group-root' && aggregate === GLYPH_WARN) return 'yellow';
  return undefined;
}

export function GroupedSidebar(props: GroupedSidebarProps): React.ReactElement {
  const {
    items,
    cycleParticipants = new Set(),
    expandedGroups,
    focused,
    width,
    selectedIdx,
    renderStatusByKey,
    previewAnnotationByKey,
    scrollOffset,
    visibleCount,
    alwaysExpanded,
    showFlatTier,
    selectionStateByKey,
    aiFlaggedByKey,
    dimPredicate,
  } = props;
  const allRows = buildVisibleRows({
    items,
    cycleParticipants,
    expandedGroups,
    alwaysExpanded,
    showFlatTier,
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
      {rows.map((row) => {
        const isSelected = row.itemIdx >= 0 && row.itemIdx === selectedIdx;
        const color = rowColor(row, row.aggregateGlyph);
        // Look up per-row inheritance status + preview annotation by the
        // component name this row represents (synthetic rows like `+N more`
        // have itemIdx < 0 and never carry decorations).
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
          row.kind !== 'group-root' &&
          row.kind !== 'group-more';
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

        // Selection glyph applies to component-backed rows only.
        const supportsSelectionGlyph =
          selectionStateByKey !== undefined &&
          itemName !== undefined &&
          (row.kind === 'standalone' ||
            row.kind === 'group-root' ||
            row.kind === 'group-child' ||
            row.kind === 'flat');
        const selState = supportsSelectionGlyph
          ? selectionStateByKey!.get(itemName!) ?? 'undecided'
          : undefined;
        let selGlyph: string | null = null;
        let selColor: string | undefined;
        let selDim = false;
        if (selState === 'accepted') {
          selGlyph = '[✓]';
          selColor = 'green';
        } else if (selState === 'rejected') {
          selGlyph = '[✗]';
          selColor = 'red';
        } else if (selState === 'undecided') {
          selGlyph = '[ ]';
          selDim = true;
        }

        const aiFlagged =
          aiFlaggedByKey !== undefined &&
          itemName !== undefined &&
          row.kind !== 'group-more' &&
          row.kind !== 'flat-header' &&
          aiFlaggedByKey.get(itemName) === true;

        const canDim =
          dimPredicate !== undefined &&
          itemName !== undefined &&
          row.kind !== 'cycle' &&
          row.kind !== 'group-root' &&
          row.kind !== 'flat-header' &&
          row.kind !== 'group-more' &&
          dimPredicate(itemName);

        const isSynthetic = row.kind === 'group-more' || row.kind === 'flat-header';
        const labelDim =
          row.kind === 'group-more' ||
          row.kind === 'flat-header' ||
          row.sharedSuffix === true ||
          canDim;

        return (
          <Box key={row.key}>
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
                <Text color={selColor} dimColor={selDim}>
                  {' ' + selGlyph}
                </Text>
              ) : (
                // Reserve the 4-char slot ("[ ] " width) so labels stay
                // column-aligned across every row (including rows that don't
                // themselves carry a selection glyph).
                <Text>{'    '}</Text>
              )
            )}
            <Text
              color={color}
              inverse={isSelected && focused}
              underline={isSelected && !focused}
              dimColor={labelDim}
              wrap="truncate"
            >
              {' '}
              {row.label}
            </Text>
            {aiFlagged && (
              <Text dimColor>{' *'}</Text>
            )}
            {inheritanceGlyph && (
              <Text color={inheritanceColor} dimColor={inheritanceDim}>
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

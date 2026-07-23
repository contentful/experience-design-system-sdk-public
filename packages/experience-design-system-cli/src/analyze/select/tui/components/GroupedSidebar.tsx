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
import { PALETTE } from '../theme.js';
import type { PreviewAnnotation } from '../../types.js';

export interface GroupedSidebarItem {
  key: string;
  entry: CDFComponentEntry;
  status: NodeStatus;
}

export interface GroupedSidebarProps {
  items: GroupedSidebarItem[];
  cycleParticipants?: Set<string>;
  selectedIdx: number;
  selectedRowIdx?: number;
  onSelect: (idx: number) => void;
  expandedGroups: Set<string>;
  onToggleExpanded: (rootName: string) => void;
  width: number;
  focused: boolean;
  renderStatusByKey?: Map<string, RenderStatus>;
  previewAnnotationByKey?: Map<string, PreviewAnnotation>;
  scrollOffset?: number;
  visibleCount?: number;
  alwaysExpanded?: boolean;
  showFlatTier?: boolean;
  selectionStateByKey?: Map<string, 'accepted' | 'rejected' | 'undecided'>;
  aiFlaggedByKey?: Map<string, boolean>;
  dimPredicate?: (componentKey: string) => boolean;
  viewMode?: 'grouped' | 'flat';
  visibleRows?: VisibleRow[];
  graph: ComponentGraphNode[];
  filterVisibleKeys?: Set<string>;
}

const GLYPH_EXPAND_COLLAPSED = '▸';
const GLYPH_EXPAND_EXPANDED = '▾';
const GLYPH_TREE_MID = '├─';
const GLYPH_TREE_LAST = '└─';
const GLYPH_WARN = '⚠';
const GLYPH_ERROR = '✗';

type RowKind = 'cycle' | 'empty' | 'group-root' | 'group-child' | 'standalone' | 'flat' | 'flat-header';

export interface VisibleRow {
  kind: RowKind;
  key: string;
  label: string;
  indent: number;
  aggregateGlyph?: string | null;
  sharedSuffix?: boolean;
  cycleChild?: boolean;
  itemIdx: number;
  rootName?: string;
}

function isEmpty(entry: CDFComponentEntry): boolean {
  return Object.keys(entry.$properties ?? {}).length === 0 && Object.keys(entry.$slots ?? {}).length === 0;
}

function aggregateGlyphFor(closure: Closure, statusByName: Map<string, NodeStatus>): string | null {
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

export function buildVisibleRows(props: {
  items: GroupedSidebarItem[];
  cycleParticipants: Set<string>;
  expandedGroups: Set<string>;
  alwaysExpanded?: boolean;
  showFlatTier?: boolean;
  viewMode?: 'grouped' | 'flat';
  graph: ComponentGraphNode[];
  filterVisibleKeys?: Set<string>;
}): VisibleRow[] {
  const { items, cycleParticipants, alwaysExpanded, showFlatTier, viewMode, graph, filterVisibleKeys } = props;

  if (viewMode === 'flat') {
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
    const otherKeySet = new Set(otherKeys);
    const flatGraph = graph.filter((n) => otherKeySet.has(n.name));
    const closures = computeAllClosures(flatGraph);
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

  const cycleKeys: string[] = [];
  const emptyKeys: string[] = [];
  const otherKeys: string[] = [];

  for (const it of items) {
    if (cycleParticipants.has(it.key)) cycleKeys.push(it.key);
    else if (isEmpty(it.entry)) emptyKeys.push(it.key);
    else otherKeys.push(it.key);
  }

  cycleKeys.sort();
  emptyKeys.sort();

  const seenCycleTierChildOccurrence = new Set<string>();

  const computeCycleMemberSubtree = (root: string): Array<{ name: string; depth: number; isCycleMember: boolean }> => {
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
      const labelName = child.isCycleMember ? `${GLYPH_WARN} ${child.name} (cycle)` : child.name;
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

  const otherKeySet = new Set(otherKeys);
  const subgraph = graph.filter((n) => otherKeySet.has(n.name));
  const closures = computeAllClosures(subgraph);
  const sharedDeps = findSharedDeps(closures);

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

  const rootNames = [...closures.keys()].sort();
  const standaloneRoots: string[] = [];
  const groupRoots: string[] = [];
  for (const root of rootNames) {
    const c = closures.get(root)!;
    const promotesForCycle = hasCycleDepDirect(root);
    if (c.nodes.length <= 1 && !promotesForCycle) standaloneRoots.push(root);
    else groupRoots.push(root);
  }

  const seenSharedOccurrence = new Set<string>();
  const seenCycleChildOccurrence = new Set<string>();

  for (const root of groupRoots) {
    const closure = closures.get(root)!;
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
    const depCount = closure.nodes.length - 1 + injectedCycleCount;
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

    const closureChildren = closure.nodes
      .filter((n) => n.name !== root)
      .slice()
      .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));

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
      const labelName = child.isCycleChild ? `${GLYPH_WARN} ${child.name} (cycle)` : child.name;
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

  if (filterVisibleKeys !== undefined) {
    return rows.filter((row) => {
      if (row.itemIdx < 0) return true;
      const name = items[row.itemIdx]?.key;
      if (name === undefined) return true;
      return filterVisibleKeys.has(name);
    });
  }

  return rows;
}

export function visibleItemOrder(props: {
  items: GroupedSidebarItem[];
  cycleParticipants: Set<string>;
  expandedGroups: Set<string>;
  alwaysExpanded?: boolean;
  showFlatTier?: boolean;
  graph: ComponentGraphNode[];
}): number[] {
  return buildVisibleRows(props)
    .filter((row) => row.itemIdx >= 0)
    .map((row) => row.itemIdx);
}

function rowColor(row: VisibleRow, aggregate?: string | null): string | undefined {
  if (row.kind === 'cycle') return PALETTE.warning;
  if (row.kind === 'group-child' && row.cycleChild) return PALETTE.warning;
  if (row.kind === 'empty') return PALETTE.warning;
  if (row.kind === 'group-root' && aggregate === GLYPH_ERROR) return PALETTE.error;
  if (row.kind === 'group-root' && aggregate === GLYPH_WARN) return PALETTE.warning;
  return undefined;
}

export function labelStyleFor(input: { row: VisibleRow; isCursor: boolean; wouldDim: boolean }): {
  color: string | undefined;
  bold: boolean;
  dim: boolean;
} {
  const { row, isCursor, wouldDim } = input;
  if (isCursor) {
    return { color: PALETTE.info, bold: true, dim: false };
  }
  return {
    color: rowColor(row, row.aggregateGlyph),
    bold: false,
    dim: wouldDim,
  };
}

export function selectionGlyphStyleFor(
  selState: 'accepted' | 'rejected' | 'undecided' | undefined,
  isCycleRow: boolean,
): { glyph: string | null; color: string | undefined; dim: boolean; bold: boolean } {
  if (selState === 'accepted') {
    return { glyph: '[✓]', color: PALETTE.success, dim: false, bold: isCycleRow };
  }
  if (selState === 'rejected') {
    return { glyph: '[✗]', color: PALETTE.error, dim: false, bold: isCycleRow };
  }
  if (selState === 'undecided') {
    return { glyph: '[ ]', color: PALETTE.muted, dim: !isCycleRow, bold: false };
  }
  return { glyph: null, color: undefined, dim: false, bold: false };
}

export function inheritanceGlyphStyleFor(input: {
  status: RenderStatus['status'] | undefined;
  isOwn: boolean;
  isCursor: boolean;
}): { glyph: string | null; color: string | undefined; dim: boolean; bold: boolean } {
  const { status, isOwn, isCursor } = input;
  if (status === 'error') {
    return { glyph: GLYPH_ERROR, color: PALETTE.error, dim: !isCursor && !isOwn, bold: isCursor };
  }
  if (status === 'warning') {
    return { glyph: GLYPH_WARN, color: PALETTE.warning, dim: !isCursor && !isOwn, bold: isCursor };
  }
  return { glyph: null, color: undefined, dim: false, bold: false };
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
    graph,
    filterVisibleKeys,
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
      graph,
      filterVisibleKeys,
    });

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
        const absoluteRowIdx = start + i;
        const isSelected =
          selectedRowIdx !== undefined
            ? absoluteRowIdx === selectedRowIdx && row.itemIdx >= 0
            : row.itemIdx >= 0 && row.itemIdx === selectedIdx;
        const itemName = row.itemIdx >= 0 ? items[row.itemIdx]?.key : undefined;
        const rs = itemName ? renderStatusByKey?.get(itemName) : undefined;
        const badge = itemName ? previewBadge(previewAnnotationByKey?.get(itemName)) : null;
        const showInheritance =
          rs !== undefined && row.kind !== 'cycle' && row.kind !== 'empty' && row.kind !== 'group-root';
        const supportsSelectionGlyph =
          selectionStateByKey !== undefined &&
          itemName !== undefined &&
          (row.kind === 'standalone' ||
            row.kind === 'group-root' ||
            row.kind === 'group-child' ||
            row.kind === 'flat' ||
            row.kind === 'cycle');
        const selState = supportsSelectionGlyph ? (selectionStateByKey!.get(itemName!) ?? 'undecided') : undefined;
        const isCycleRow = row.kind === 'cycle';
        const selStyle = selectionGlyphStyleFor(selState, isCycleRow);
        const selGlyph = selStyle.glyph;
        const selColor = selStyle.color;
        const selDim = selStyle.dim;
        const selBold = selStyle.bold;

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
        const wouldDim = row.kind === 'flat-header' || row.sharedSuffix === true || canDim;
        const labelStyle = labelStyleFor({ row, isCursor, wouldDim });
        const inheritanceStyle = inheritanceGlyphStyleFor({
          status: showInheritance ? rs?.status : undefined,
          isOwn: rs?.isOwn ?? false,
          isCursor,
        });

        return (
          <Box key={row.key}>
            {isCursor ? (
              <Text color={PALETTE.info} bold>
                {'▶'}
              </Text>
            ) : (
              <Text> </Text>
            )}
            {badge ? (
              <Text color={badge.color} bold={badge.bold} dimColor={badge.dim}>
                {badge.char}
              </Text>
            ) : (
              <Text> </Text>
            )}
            {selectionStateByKey !== undefined &&
              (selGlyph && !isSynthetic ? (
                <Text color={selColor} dimColor={selDim} bold={selBold}>
                  {' ' + selGlyph}
                </Text>
              ) : (
                <Text>{'    '}</Text>
              ))}
            {aiFlaggedByKey !== undefined &&
              (aiFlagged ? (
                <Text color={PALETTE.warning} bold>
                  {' [×]'}
                </Text>
              ) : (
                <Text>{'    '}</Text>
              ))}
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
            {inheritanceStyle.glyph && (
              <Text color={inheritanceStyle.color} bold={inheritanceStyle.bold} dimColor={inheritanceStyle.dim}>
                {' ' + inheritanceStyle.glyph}
              </Text>
            )}
          </Box>
        );
      })}
      {showScrollDown && <Text dimColor>▼</Text>}
    </Box>
  );
}

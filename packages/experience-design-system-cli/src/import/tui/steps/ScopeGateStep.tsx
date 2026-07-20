import { Box, Text, useStdout } from 'ink';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';
import {
  GroupedSidebar,
  buildVisibleRows,
  type GroupedSidebarItem,
} from '../../../analyze/select/tui/components/GroupedSidebar.js';
import {
  computeAllClosures,
  type ComponentGraphNode,
  type NodeStatus,
} from '../../../analyze/composite-closure.js';
import { buildComponentGraph } from '../../../analyze/slot-graph.js';
import { findSlotCycles, type SlotCycle } from '../../../analyze/cycle-detection.js';
import { computeAutocomplete } from '../autocomplete.js';
import {
  buildFlatDimPredicate,
  computeFilterKeys,
  intersectFilterKeys,
  type FilterCategory,
} from '../step-filters.js';
import { useLineage } from '../hooks/useLineage.js';
import { useOverlayPanel } from '../hooks/useOverlayPanel.js';
import { computeSidebarBudget, FALLBACK_ROWS } from '../lineage-layout.js';
import { LineagePanel } from '../../../analyze/select/tui/components/LineagePanel.js';
import { GotoBanner } from '../../../analyze/select/tui/components/GotoBanner.js';
import { HelpOverlay, type HelpSection } from '../../../analyze/select/tui/components/HelpOverlay.js';
import { legendEntry } from '../components/LegendEntry.js';
import { AutoFilterBanner } from '../components/AutoFilterBanner.js';
import { CounterStrip } from '../components/CounterStrip.js';
import { isAiFlagged } from '../ai-flag.js';
import { resolveGroupRoot } from '../group-collapse.js';
import {
  buildCycleUnits,
  collectReachableCycleUnits,
  computeCycleAwareAcceptCascade,
  computeCycleAwareRejectCascade,
} from '../../../analyze/scope-gate-cascade.js';
import { fuzzyMatches } from '../../../analyze/fuzzy-search.js';
import {
  computeDirectNeighborhood,
  findAllAncestors,
} from '../../../analyze/search-neighborhood.js';
import {
  buildAddedComponentsList,
  buildAddedGroupsList,
  computeColumnWidths,
  computeCounters,
  type AddedComponentEntry,
  type AddedGroupEntry,
} from '../scope-gate-columns.js';

export type ScopeComponent = {
  name: string;
  componentId: string;
  aiDecision?: 'accepted' | 'rejected' | 'failed' | null;
  aiReason?: string | null;
  slots?: Array<{ name: string; allowedComponents: string[] }>;
};

export type ScopeGateStepProps = {
  components: ScopeComponent[];
  onConfirm: (decisions: { accepted: string[]; rejected: string[] }) => void;
  onQuit: () => void;
  aiFilterStatus?: 'idle' | 'running' | 'complete' | 'cancelled' | 'failed';
  aiFilterProgress?: { done: number; total: number } | null;
  aiFilterError?: string | null;
  onCancelAutoFilter?: () => void;
};

const FOCUSED_REASON_MAX_LINES = 4;

const HELP_SECTIONS: HelpSection[] = [
  {
    title: 'Navigation',
    entries: [
      { keys: 'j / k / ↑ / ↓', label: 'Move cursor' },
      { keys: 'Tab / Shift-Tab', label: 'Switch column' },
      { keys: 'Enter', label: 'Jump to main' },
    ],
  },
  {
    title: 'Selection',
    entries: [
      { keys: 'a', label: 'Accept' },
      { keys: 'r', label: 'Reject' },
      { keys: 'A', label: 'Toggle all' },
      { keys: 'Y', label: 'Accept non-flagged' },
    ],
  },
  {
    title: 'Sidebar views',
    entries: [
      { keys: 'L', label: 'Flat view' },
      { keys: 'l', label: 'Lineage' },
      { keys: 'i', label: 'Focus lineage' },
      { keys: 'o', label: 'Only cycles' },
      { keys: 'space', label: 'Expand/collapse group' },
      { keys: 'E / C', label: 'Expand/collapse all' },
    ],
  },
  {
    title: 'Panels',
    entries: [
      { keys: 'c', label: 'Cycle list' },
      { keys: 'x', label: 'AI exclusions' },
    ],
  },
  {
    title: 'Search',
    entries: [
      { keys: '/', label: 'Search' },
    ],
  },
  {
    title: 'General',
    entries: [
      { keys: 'f', label: 'Continue' },
      { keys: '?', label: 'Close help' },
      { keys: 'q', label: 'Quit' },
    ],
  },
];

function capReasonForFocusedRow(reason: string, width: number): string {
  const safeWidth = Math.max(20, width);
  const budget = safeWidth * FOCUSED_REASON_MAX_LINES;
  if (reason.length <= budget) return reason;
  return reason.slice(0, budget - 1).trimEnd() + '…';
}

function toSidebarEntry(c: ScopeComponent): CDFComponentEntry {
  const $slots: NonNullable<CDFComponentEntry['$slots']> = {};
  if (c.slots) {
    for (const s of c.slots) {
      $slots[s.name] = { $allowedComponents: s.allowedComponents };
    }
  }
  const entry: CDFComponentEntry = {
    $type: 'component',
    $properties: { __scopeGate: { $type: 'string', $category: 'content' } },
  };
  if (Object.keys($slots).length > 0) entry.$slots = $slots;
  return entry;
}

export function ScopeGateStep({
  components,
  onConfirm,
  onQuit,
  aiFilterStatus = 'idle',
  aiFilterProgress = null,
  aiFilterError = null,
  onCancelAutoFilter,
}: ScopeGateStepProps): React.ReactElement {
  const { stdout } = useStdout();
  const totalWidth = stdout?.columns ?? 80;
  const columnPlan = useMemo(() => computeColumnWidths(totalWidth), [totalWidth]);
  const sidebarWidth = columnPlan.main;
  type Decision = 'accepted' | 'rejected' | 'undecided';
  const [userDecisions, setUserDecisions] = useState<Map<string, Decision>>(new Map());
  const [nav, setNav] = useState<{ cursor: number; scrollOffset: number }>({ cursor: 0, scrollOffset: 0 });
  type FocusedColumn = 'main' | 'added-components' | 'added-groups';
  const [focusedColumn, setFocusedColumn] = useState<FocusedColumn>('main');
  const [addedComponentsCursor, setAddedComponentsCursor] = useState(0);
  const [addedGroupsCursor, setAddedGroupsCursor] = useState(0);
  const cursor = nav.cursor;
  const scrollOffset = nav.scrollOffset;
  const lineagePanel = useOverlayPanel({ toggleKey: 'l' });
  const [lineageCursor, setLineageCursor] = useState(0);
  const [cyclesPanelOpen, setCyclesPanelOpen] = useState(false);
  const [cyclesCursor, setCyclesCursor] = useState(0);
  const aiRationalePanel = useOverlayPanel({ toggleKey: 'x' });
  const [aiCursor, setAiCursor] = useState(0);
  const [pendingRejectCascade, setPendingRejectCascade] =
    useState<{ target: string; ancestors: string[]; descendants: string[] } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [autocompleteCandidates, setAutocompleteCandidates] = useState<string[]>([]);
  const [jumpFilterTarget, setJumpFilterTarget] = useState<string | null>(null);
  const [columnOneView, setColumnOneView] = useState<'grouped' | 'flat'>('grouped');
  const [activeFilters, setActiveFilters] = useState<Set<FilterCategory>>(new Set());
  const [showHelp, setShowHelp] = useState(false);

  const getState = (name: string): Decision => {
    const v = userDecisions.get(name);
    return v ?? 'undecided';
  };

  const isIncluded = (name: string): boolean => getState(name) === 'accepted';

  const applyDecisions = (entries: Iterable<[string, Decision]>): void => {
    setUserDecisions((prev) => {
      const next = new Map(prev);
      for (const [name, decision] of entries) next.set(name, decision);
      return next;
    });
  };

  const groupedItems: GroupedSidebarItem[] = useMemo(
    () =>
      components.map((c) => ({
        key: c.name,
        entry: toSidebarEntry(c),
        status: isAiFlagged(c) ? ('warning' as NodeStatus) : ('ok' as NodeStatus),
      })),
    [components],
  );

  const graph: ComponentGraphNode[] = useMemo(
    () => buildComponentGraph(groupedItems),
    [groupedItems],
  );

  const slotCycles = useMemo<SlotCycle[]>(() => {
    try {
      return findSlotCycles(graph);
    } catch {
      return [];
    }
  }, [graph]);

  const cycleParticipants = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    for (const c of slotCycles) for (const n of c.path) set.add(n);
    return set;
  }, [slotCycles]);

  const cycleUnits = useMemo(() => buildCycleUnits(slotCycles), [slotCycles]);

  const cyclesJumpables = useMemo(
    () =>
      slotCycles.map((c, i) => ({
        cycleIndex: i,
        jumpTarget: c.path[0],
      })),
    [slotCycles],
  );

  const hasCycles = slotCycles.length > 0;

  const closures = useMemo(() => computeAllClosures(graph), [graph]);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    const seed = new Set<string>(closures.keys());
    for (const p of cycleParticipants) seed.add(p);
    return seed;
  });
  const seededGroupsRef = useRef(closures.size > 0 || cycleParticipants.size > 0);
  useEffect(() => {
    if (seededGroupsRef.current) return;
    if (closures.size === 0 && cycleParticipants.size === 0) return;
    seededGroupsRef.current = true;
    const seed = new Set<string>(closures.keys());
    for (const p of cycleParticipants) seed.add(p);
    setExpandedGroups(seed);
  }, [closures, cycleParticipants]);

  const hasGroupRoots = useMemo(() => {
    if (cycleParticipants.size > 0) return true;
    for (const c of closures.values()) if (c.nodes.length > 1) return true;
    return false;
  }, [closures, cycleParticipants]);

  const toggleExpanded = (rootName: string): void => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(rootName)) next.delete(rootName);
      else next.add(rootName);
      return next;
    });
  };

  const brokenKeys = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    for (const c of components) if (isAiFlagged(c)) set.add(c.name);
    return set;
  }, [components]);

  const filterVisibleKeys = useMemo<Set<string> | undefined>(() => {
    if (jumpFilterTarget) {
      return findAllAncestors(jumpFilterTarget, graph);
    }
    const categoryKeys = computeFilterKeys({
      filters: activeFilters,
      data: { cycles: cycleParticipants, broken: brokenKeys },
    });
    const searchKeys = (() => {
      if (!searchQuery) return undefined;
      const matches = groupedItems
        .map((it) => it.key)
        .filter((k) => fuzzyMatches(searchQuery, k));
      if (matches.length === 0) return undefined;
      return computeDirectNeighborhood(matches, graph);
    })();
    return intersectFilterKeys(categoryKeys, searchKeys);
  }, [jumpFilterTarget, activeFilters, cycleParticipants, brokenKeys, searchQuery, groupedItems, graph]);

  const visibleRows = useMemo(
    () =>
      buildVisibleRows({
        items: groupedItems,
        cycleParticipants,
        expandedGroups,
        showFlatTier: false,
        viewMode: columnOneView,
        graph,
        filterVisibleKeys,
      }),
    [groupedItems, cycleParticipants, expandedGroups, columnOneView, graph, filterVisibleKeys],
  );

  const total = visibleRows.length;
  const safeCursor = Math.min(cursor, Math.max(0, total - 1));

  const currentRow = visibleRows[safeCursor];
  const currentRowKey =
    currentRow && currentRow.itemIdx >= 0 ? groupedItems[currentRow.itemIdx]?.key : undefined;
  const focusedComponent = currentRowKey
    ? components.find((c) => c.name === currentRowKey)
    : undefined;

  const selectionStateByKey = useMemo(() => {
    const map = new Map<string, 'accepted' | 'rejected' | 'undecided'>();
    for (const c of components) {
      map.set(c.name, getState(c.name));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [components, userDecisions]);

  const aiFlaggedByKey = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const c of components) map.set(c.name, isAiFlagged(c));
    return map;
  }, [components]);

  const dimPredicate = useMemo(
    () =>
      buildFlatDimPredicate({
        viewMode: columnOneView,
        searchQuery,
        filterVisibleKeys,
      }),
    [columnOneView, searchQuery, filterVisibleKeys],
  );

  const applyReject = (target: string): void => {
    const { toReject, toDeselect } = computeCycleAwareRejectCascade(
      target,
      graph,
      cycleUnits,
    );
    const entries: Array<[string, Decision]> = [];
    for (const n of toReject) entries.push([n, 'rejected']);
    for (const n of toDeselect) entries.push([n, 'undecided']);
    applyDecisions(entries);
  };
  const applyAccept = (target: string): void => {
    const cascade = computeCycleAwareAcceptCascade(target, graph, cycleUnits);
    applyDecisions([...cascade].map((n) => [n, 'accepted'] as [string, Decision]));
  };

  const requestAccept = (name: string): void => {
    if (getState(name) === 'accepted') return;
    applyAccept(name);
  };

  const requestReject = (name: string): void => {
    if (getState(name) === 'rejected') return;
    const { toReject, toDeselect } = computeCycleAwareRejectCascade(
      name,
      graph,
      cycleUnits,
    );
    const ancestors = [...toReject].filter((n) => n !== name).sort();
    const descendants = [...toDeselect].sort();
    if (ancestors.length + descendants.length >= 2) {
      setPendingRejectCascade({ target: name, ancestors, descendants });
      return;
    }
    applyReject(name);
  };

  const focusedRowKey = (): string | undefined => {
    const row = visibleRows[safeCursor];
    if (!row) return undefined;
    switch (row.kind) {
      case 'standalone':
      case 'empty':
      case 'group-root':
      case 'group-child':
      case 'flat':
      case 'cycle':
        return row.itemIdx >= 0 ? groupedItems[row.itemIdx]?.key : undefined;
      default:
        return undefined;
    }
  };

  const partition = (): { accepted: string[]; rejected: string[] } => {
    const accepted: string[] = [];
    const rejected: string[] = [];
    for (const c of components) {
      if (getState(c.name) === 'accepted') accepted.push(c.name);
      else rejected.push(c.name);
    }
    return { accepted, rejected };
  };

  const { entries: lineageEntries, jumpables: lineageJumpables } = useLineage(
    focusedComponent?.name ?? null,
    graph,
  );

  const { sidebarVisibleCount: visibleCount, panelMaxRows } = computeSidebarBudget({
    rows: stdout?.rows ?? FALLBACK_ROWS,
    panelOpen: lineagePanel.isOpen,
    entryCount: lineageEntries.length,
  });

  useEffect(() => {
    setNav((prev) => {
      const maxIdx = Math.max(0, visibleRows.length - 1);
      const nextCursor = Math.min(prev.cursor, maxIdx);
      const nextScroll = Math.min(prev.scrollOffset, maxIdx);
      if (nextCursor === prev.cursor && nextScroll === prev.scrollOffset) return prev;
      return { cursor: nextCursor, scrollOffset: nextScroll };
    });
  }, [visibleRows]);

  const searchMatches = useMemo(() => {
    if (!searchQuery) return [];
    return components.filter((c) => fuzzyMatches(searchQuery, c.name)).map((c) => c.name);
  }, [components, searchQuery]);

  const findRowIndexForName = (name: string): number => {
    for (let i = 0; i < visibleRows.length; i++) {
      const row = visibleRows[i];
      if (row.itemIdx < 0) continue;
      if (groupedItems[row.itemIdx]?.key === name) return i;
    }
    return -1;
  };

  const jumpCursorTo = (name: string): void => {
    const idx = findRowIndexForName(name);
    if (idx < 0) return;
    setNav(({ scrollOffset: prev }) => {
      let nextScroll = prev;
      if (idx < prev) nextScroll = idx;
      else if (idx >= prev + visibleCount) nextScroll = idx - visibleCount + 1;
      return { cursor: idx, scrollOffset: nextScroll };
    });
  };

  useImmediateInput((input, key) => {
    if (showHelp) return;

    if (pendingRejectCascade) {
      if (input === 'y' || input === 'Y') {
        applyReject(pendingRejectCascade.target);
        setPendingRejectCascade(null);
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setPendingRejectCascade(null);
        return;
      }
      return;
    }

    if (searchOpen) {
      if (key.escape) {
        setSearchOpen(false);
        setSearchQuery('');
        setAutocompleteCandidates([]);
        return;
      }
      if (key.return) {
        if (!searchQuery || searchMatches.length === 0) {
          setSearchOpen(false);
          setSearchQuery('');
          setAutocompleteCandidates([]);
          return;
        }
        const cursorRow = visibleRows[safeCursor];
        const cursorItemName =
          cursorRow && cursorRow.itemIdx >= 0
            ? groupedItems[cursorRow.itemIdx]?.key
            : undefined;
        let jumped = false;
        for (let i = safeCursor; i < visibleRows.length; i++) {
          const r = visibleRows[i];
          if (r.itemIdx < 0) continue;
          const n = groupedItems[r.itemIdx]?.key;
          if (n && n !== cursorItemName && fuzzyMatches(searchQuery, n)) {
            jumpCursorTo(n);
            jumped = true;
            break;
          }
        }
        if (!jumped) {
          for (let i = 0; i < visibleRows.length; i++) {
            const r = visibleRows[i];
            if (r.itemIdx < 0) continue;
            const n = groupedItems[r.itemIdx]?.key;
            if (n && fuzzyMatches(searchQuery, n)) {
              jumpCursorTo(n);
              break;
            }
          }
        }
        setSearchOpen(false);
        return;
      }
      if (key.tab) {
        const { completion, candidates } = computeAutocomplete(
          searchQuery,
          components.map((c) => c.name),
        );
        setSearchQuery(completion);
        setAutocompleteCandidates(candidates);
        return;
      }
      if (key.backspace) {
        setAutocompleteCandidates([]);
        setSearchQuery((q) => q.slice(0, -1));
        return;
      }
      if (input && input.length === 1 && input >= ' ' && input !== '\r' && input !== '\n') {
        setAutocompleteCandidates([]);
        setSearchQuery((q) => q + input);
        return;
      }
      return;
    }

    if (cyclesPanelOpen) {
      if (key.escape || input === 'c') {
        setCyclesPanelOpen(false);
        return;
      }
      if (key.upArrow || input === 'k') {
        setCyclesCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setCyclesCursor((c) => Math.min(Math.max(0, cyclesJumpables.length - 1), c + 1));
        return;
      }
      if (key.return) {
        const target = cyclesJumpables[cyclesCursor];
        if (target) jumpCursorTo(target.jumpTarget);
        setCyclesPanelOpen(false);
        return;
      }
      return;
    }

    if (lineagePanel.isOpen) {
      if (input === 'c' && hasCycles) {
        lineagePanel.close();
        setCyclesPanelOpen(true);
        setCyclesCursor(0);
        return;
      }
      if (lineagePanel.handleInput(input, key)) return;
      if (key.upArrow || input === 'k') {
        setLineageCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setLineageCursor((c) => Math.min(Math.max(0, lineageJumpables.length - 1), c + 1));
        return;
      }
      if (key.return) {
        const target = lineageJumpables[lineageCursor];
        if (target && (target.entry.kind === 'ancestor' || target.entry.kind === 'descendant')) {
          jumpCursorTo(target.entry.jumpTarget);
        }
        lineagePanel.close();
        return;
      }
      return;
    }

    if (aiRationalePanel.isOpen) {
      if (aiRationalePanel.handleInput(input, key)) return;
      if (key.upArrow || input === 'k') {
        setAiCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setAiCursor((c) => Math.min(Math.max(0, aiRows.length - 1), c + 1));
        return;
      }
      if (key.return) {
        const row = aiRows[aiCursor];
        if (row) jumpCursorTo(row.jumpTarget);
        aiRationalePanel.close();
        return;
      }
      return;
    }

    if (input === 'q' || key.escape) {
      if (aiFilterStatus === 'running' && onCancelAutoFilter) {
        onCancelAutoFilter();
        return;
      }
      if (key.escape && jumpFilterTarget) {
        setJumpFilterTarget(null);
        return;
      }
      if (key.escape && searchQuery) {
        setSearchQuery('');
        setAutocompleteCandidates([]);
        return;
      }
      onQuit();
      return;
    }
    if (input === '?') {
      setShowHelp(true);
      return;
    }
    if (input === 'f' || input === 'F') {
      onConfirm(partition());
      return;
    }
    if (input === 'l') {
      if (focusedColumn === 'added-components') {
        const entry = addedComponents[safeAddedComponentsCursor];
        if (entry) jumpCursorTo(entry.name);
      } else if (focusedColumn === 'added-groups') {
        const g = addedGroups[safeAddedGroupsCursor];
        if (g) jumpCursorTo(g.name);
      }
      lineagePanel.open();
      setLineageCursor(0);
      setCyclesPanelOpen(false);
      aiRationalePanel.close();
      return;
    }
    if (input === 'c') {
      if (!hasCycles) return;
      setCyclesPanelOpen(true);
      setCyclesCursor(0);
      lineagePanel.close();
      aiRationalePanel.close();
      return;
    }
    if (input === 'x') {
      if (aiRows.length === 0) return;
      aiRationalePanel.open();
      setAiCursor(0);
      lineagePanel.close();
      setCyclesPanelOpen(false);
      return;
    }
    if (input === '/') {
      setSearchOpen(true);
      return;
    }
    if (input === 'o') {
      if (!hasCycles) return;
      setActiveFilters((prev) => {
        const next = new Set(prev);
        if (next.has('cycles')) next.delete('cycles');
        else next.add('cycles');
        return next;
      });
      return;
    }
    if (input === 'i' && !key.tab && !key.ctrl) {
      const targetKey =
        focusedColumn === 'main'
          ? focusedRowKey()
          : focusedColumn === 'added-components'
            ? addedComponents[safeAddedComponentsCursor]?.name
            : addedGroups[safeAddedGroupsCursor]?.name;
      if (!targetKey) return;
      setJumpFilterTarget((prev) => (prev === targetKey ? null : targetKey));
      return;
    }
    if (input === ' ') {
      if (focusedColumn !== 'main') return;
      const key = focusedRowKey();
      if (!key) return;
      const rootName = resolveGroupRoot(key, closures, cycleParticipants);
      if (!rootName) return;
      toggleExpanded(rootName);
      return;
    }
    if (input === 'E' && focusedColumn === 'main') {
      const roots = new Set<string>();
      for (const [name, closure] of closures.entries()) {
        if (closure.nodes.length > 1) roots.add(name);
      }
      for (const p of cycleParticipants) roots.add(p);
      setExpandedGroups(roots);
      return;
    }
    if (input === 'C' && focusedColumn === 'main') {
      setExpandedGroups(new Set());
      return;
    }
    if (input === 'a' || input === 'r') {
      const isReject = input === 'r';
      if (focusedColumn === 'added-components') {
        if (!isReject) return;
        const entry = addedComponents[safeAddedComponentsCursor];
        if (entry) requestReject(entry.name);
        return;
      }
      if (focusedColumn === 'added-groups') {
        if (!isReject) return;
        const g = addedGroups[safeAddedGroupsCursor];
        if (g) requestReject(g.name);
        return;
      }
      const key = focusedRowKey();
      if (!key) return;
      if (isReject) requestReject(key);
      else requestAccept(key);
      return;
    }
    if (input === 'L') {
      const currentKey = currentRowKey;
      const nextView: 'grouped' | 'flat' =
        columnOneView === 'grouped' ? 'flat' : 'grouped';
      const nextRows = buildVisibleRows({
        items: groupedItems,
        cycleParticipants,
        expandedGroups,
        showFlatTier: false,
        viewMode: nextView,
        graph,
      });
      let nextCursor = 0;
      if (currentKey) {
        for (let i = 0; i < nextRows.length; i++) {
          const r = nextRows[i];
          if (r.itemIdx < 0) continue;
          if (groupedItems[r.itemIdx]?.key === currentKey) {
            nextCursor = i;
            break;
          }
        }
      }
      const nextScroll =
        nextCursor < scrollOffset
          ? nextCursor
          : nextCursor >= scrollOffset + visibleCount
            ? nextCursor - visibleCount + 1
            : scrollOffset;
      setColumnOneView(nextView);
      setNav({ cursor: nextCursor, scrollOffset: nextScroll });
      return;
    }
    if (input === 'A') {
      const nonCycle = components
        .filter((c) => !cycleParticipants.has(c.name))
        .map((c) => c.name);
      const anyNotAccepted = nonCycle.some((n) => getState(n) !== 'accepted');
      const target: Decision = anyNotAccepted ? 'accepted' : 'rejected';
      if (target === 'accepted') {
        const cyclesToInclude = collectReachableCycleUnits(
          nonCycle,
          graph,
          cycleUnits,
        );
        const entries: Array<[string, Decision]> = nonCycle.map(
          (n) => [n, 'accepted'] as [string, Decision],
        );
        for (const n of cyclesToInclude) entries.push([n, 'accepted']);
        applyDecisions(entries);
      } else {
        const entries: Array<[string, Decision]> = nonCycle.map(
          (n) => [n, 'rejected'] as [string, Decision],
        );
        for (const c of components) {
          if (cycleParticipants.has(c.name) && getState(c.name) === 'accepted') {
            entries.push([c.name, 'undecided']);
          }
        }
        applyDecisions(entries);
      }
      return;
    }
    if (input === 'Y') {
      const seeds = components
        .filter((c) => !cycleParticipants.has(c.name) && !isAiFlagged(c))
        .map((c) => c.name);
      const cyclesToInclude = collectReachableCycleUnits(seeds, graph, cycleUnits);
      const entries: Array<[string, Decision]> = seeds.map(
        (n) => [n, 'accepted'] as [string, Decision],
      );
      for (const n of cyclesToInclude) entries.push([n, 'accepted']);
      applyDecisions(entries);
      return;
    }
    if (key.tab) {
      if (columnPlan.layout !== 'three-column') return;
      const forward: FocusedColumn[] = ['main', 'added-components', 'added-groups'];
      const curIdx = forward.indexOf(focusedColumn);
      const delta = key.shiftTab ? -1 : 1;
      setFocusedColumn(forward[(curIdx + delta + forward.length) % forward.length]);
      return;
    }
    if (key.return) {
      if (focusedColumn === 'added-components') {
        const entry = addedComponents[safeAddedComponentsCursor];
        if (entry) jumpCursorTo(entry.name);
        setFocusedColumn('main');
        return;
      }
      if (focusedColumn === 'added-groups') {
        const g = addedGroups[safeAddedGroupsCursor];
        if (g) jumpCursorTo(g.name);
        setFocusedColumn('main');
        return;
      }
      return;
    }
    if (key.upArrow || input === 'k') {
      if (focusedColumn === 'added-components') {
        if (addedComponents.length === 0) return;
        setAddedComponentsCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (focusedColumn === 'added-groups') {
        if (addedGroups.length === 0) return;
        setAddedGroupsCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (total === 0) return;
      setNav(({ cursor: c, scrollOffset: prev }) => {
        const next = c <= 0 ? 0 : c - 1;
        return { cursor: next, scrollOffset: Math.min(prev, next) };
      });
      return;
    }
    if (key.downArrow || input === 'j') {
      if (focusedColumn === 'added-components') {
        if (addedComponents.length === 0) return;
        setAddedComponentsCursor((c) => Math.min(addedComponents.length - 1, c + 1));
        return;
      }
      if (focusedColumn === 'added-groups') {
        if (addedGroups.length === 0) return;
        setAddedGroupsCursor((c) => Math.min(addedGroups.length - 1, c + 1));
        return;
      }
      if (total === 0) return;
      setNav(({ cursor: c, scrollOffset: prev }) => {
        const next = c >= total - 1 ? total - 1 : c + 1;
        const nextScroll = next >= prev + visibleCount ? next - visibleCount + 1 : prev;
        return { cursor: next, scrollOffset: nextScroll };
      });
      return;
    }
  });

  const includedCount = useMemo(
    () => components.filter((c) => isIncluded(c.name)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [components, userDecisions],
  );
  const hasAnyAi = components.some(isAiFlagged);
  const aiExcludedCount = components.filter(isAiFlagged).length;
  const aiExcludedWithReasons = components.filter(
    (c) => isAiFlagged(c) && c.aiReason !== null && c.aiReason !== undefined && c.aiReason !== '',
  );
  const aiRows = useMemo(
    () =>
      aiExcludedWithReasons.map((c) => ({
        label: `${c.name} — ${c.aiReason}`,
        jumpTarget: c.name,
      })),
    [aiExcludedWithReasons],
  );

  const selectedItemIdx =
    currentRow && currentRow.itemIdx >= 0 ? currentRow.itemIdx : -1;

  const nothingIncluded = components.length > 0 && components.every((c) => !isIncluded(c.name));

  const totalComponents = components.length;
  const totalMatches = searchQuery ? searchMatches.length : 0;

  const addedComponents = useMemo(
    () => buildAddedComponentsList(components, selectionStateByKey, cycleParticipants),
    [components, selectionStateByKey, cycleParticipants],
  );
  const addedGroups = useMemo(
    () => buildAddedGroupsList(closures, selectionStateByKey, cycleParticipants, cycleUnits),
    [closures, selectionStateByKey, cycleParticipants, cycleUnits],
  );
  const counters = useMemo(
    () => computeCounters(components, closures, selectionStateByKey),
    [components, closures, selectionStateByKey],
  );

  const safeAddedComponentsCursor = Math.min(
    addedComponentsCursor,
    Math.max(0, addedComponents.length - 1),
  );
  const safeAddedGroupsCursor = Math.min(
    addedGroupsCursor,
    Math.max(0, addedGroups.length - 1),
  );

  if (showHelp) {
    return <HelpOverlay sections={HELP_SECTIONS} onClose={() => setShowHelp(false)} />;
  }

  return (
    <Box flexDirection="column" paddingX={2}>
      <Text color={PALETTE.success}>✓ Extraction complete</Text>
      <Text dimColor>
        Found {totalComponents} component{totalComponents === 1 ? '' : 's'}. Pick which ones to import. Generation runs
        only on the included set.
      </Text>

      <AutoFilterBanner status={aiFilterStatus} progress={aiFilterProgress} error={aiFilterError} />


      {hasAnyAi && (
        <Box>
          <Text dimColor>
            {`AI recommended exclusions (${aiExcludedCount})`}
            {aiRows.length > 0 && <Text color={PALETTE.info}>{' — [x] review & jump'}</Text>}
          </Text>
        </Box>
      )}

      <CounterStrip counters={counters} totalWidth={totalWidth} />

      {hasCycles && (
        <Box marginTop={1}>
          <Text dimColor>
            If you must have components with cycles, select them together into the generate step and then use the editor to fix them.
          </Text>
        </Box>
      )}

      {nothingIncluded && (
        <Box marginTop={1}>
          <Text color={PALETTE.warning}>
            nothing selected — press{' '}
            <Text color={PALETTE.info}>[Y]</Text> to accept all non-flagged,{' '}
            <Text color={PALETTE.info}>[A]</Text> to toggle all, or{' '}
            <Text color={PALETTE.info}>[a]</Text> to accept the highlighted row
          </Text>
        </Box>
      )}

      <Box flexDirection="row">
        {aiRationalePanel.isOpen ? (
          <GotoBanner
            title={`AI recommended exclusions (${aiExcludedCount})`}
            rows={aiRows}
            cursor={aiCursor}
            maxRows={panelMaxRows}
            width={sidebarWidth}
            footerHint="[↑/↓] move · [Enter] jump · [x/Esc] close"
          />
        ) : lineagePanel.isOpen && focusedComponent ? (
          <LineagePanel
            focusedComponentKey={focusedComponent.name}
            entries={lineageEntries}
            cursor={lineageCursor}
            jumpables={lineageJumpables}
            maxRows={panelMaxRows}
            width={sidebarWidth}
          />
        ) : (
          <GroupedSidebar
            items={groupedItems}
            cycleParticipants={cycleParticipants}
            selectedIdx={selectedItemIdx}
            selectedRowIdx={safeCursor}
            onSelect={() => {}}
            expandedGroups={expandedGroups}
            onToggleExpanded={toggleExpanded}
            width={sidebarWidth}
            focused={focusedColumn === 'main'}
            scrollOffset={scrollOffset}
            visibleCount={visibleCount}
            showFlatTier={false}
            selectionStateByKey={selectionStateByKey}
            aiFlaggedByKey={aiFlaggedByKey}
            dimPredicate={dimPredicate}
            visibleRows={visibleRows}
            viewMode={columnOneView}
            graph={graph}
          />
        )}
        {columnPlan.layout === 'three-column' && (
          <>
            <Box width={2} flexShrink={0} />
            <AddedComponentsColumn
              width={columnPlan.added}
              entries={addedComponents}
              cursor={safeAddedComponentsCursor}
              focused={focusedColumn === 'added-components'}
              aiFlaggedByKey={aiFlaggedByKey}
              visibleCount={visibleCount}
            />
            <Box width={2} flexShrink={0} />
            <AddedGroupsColumn
              width={columnPlan.groups}
              entries={addedGroups}
              cursor={safeAddedGroupsCursor}
              focused={focusedColumn === 'added-groups'}
              aiFlaggedByKey={aiFlaggedByKey}
              visibleCount={visibleCount}
            />
          </>
        )}
      </Box>

      {focusedComponent && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text color={PALETTE.info}>{focusedComponent.name}</Text>
            <Text dimColor>{' — '}</Text>
            {isIncluded(focusedComponent.name) ? (
              <Text color={PALETTE.success}>included</Text>
            ) : (
              <Text color={PALETTE.error}>excluded</Text>
            )}
            {isAiFlagged(focusedComponent) && <Text color={PALETTE.warning} bold>{' [×]'}</Text>}
          </Text>
          {isAiFlagged(focusedComponent) &&
            focusedComponent.aiReason !== null &&
            focusedComponent.aiReason !== undefined &&
            focusedComponent.aiReason !== '' && (
              <Box width={totalWidth} height={FOCUSED_REASON_MAX_LINES} flexShrink={0}>
                <Text dimColor wrap="wrap">
                  {capReasonForFocusedRow(focusedComponent.aiReason, totalWidth)}
                </Text>
              </Box>
            )}
        </Box>
      )}


      {cyclesPanelOpen && (
        <Box flexDirection="column" borderStyle="single" borderColor={PALETTE.warning} paddingX={1} marginTop={1}>
          <Text bold color={PALETTE.warning}>{`Cycles detected (${slotCycles.length}):`}</Text>
          <Text> </Text>
          {slotCycles.map((cycle, i) => {
            const isCursor = i === cyclesCursor;
            const parts: string[] = [];
            for (let idx = 0; idx < cycle.edges.length; idx++) {
              parts.push(cycle.path[idx]);
              parts.push(`[${cycle.edges[idx].slotName}]`);
            }
            parts.push(cycle.path[cycle.path.length - 1]);
            const label = `Cycle ${i + 1}: ${parts.join(' → ')}`;
            return (
              <Text key={i}>
                {isCursor ? (
                  <Text color={PALETTE.info} bold>{'▶'}</Text>
                ) : (
                  <Text> </Text>
                )}
                <Text color={PALETTE.warning} inverse={isCursor}>{' ' + label}</Text>
              </Text>
            );
          })}
          <Text dimColor>[↑/↓] move · [Enter] jump · [c/Esc] close</Text>
        </Box>
      )}

      {pendingRejectCascade && (
        <Box flexDirection="column" borderStyle="single" borderColor={PALETTE.warning} paddingX={1} marginTop={1}>
          <Text bold color={PALETTE.warning}>
            {`Rejecting ${pendingRejectCascade.target} will:`}
          </Text>
          {pendingRejectCascade.ancestors.length > 0 && (
            <Text>
              {`- Reject ancestors: ${pendingRejectCascade.ancestors.join(', ')}`}
            </Text>
          )}
          {pendingRejectCascade.descendants.length > 0 && (
            <Text>
              {`- Deselect descendants: ${pendingRejectCascade.descendants.join(', ')}`}
            </Text>
          )}
          <Text dimColor>[y] confirm · [n]/[Esc] cancel</Text>
        </Box>
      )}

      {searchOpen && (
        <Box marginTop={1} flexDirection="column">
          <Text>
            {`/${searchQuery}`}
            <Text color={PALETTE.info}>{'▎'}</Text>
            {searchQuery && (
              <Text dimColor>{`  (${totalMatches}/${totalComponents} matches)`}</Text>
            )}
          </Text>
          {autocompleteCandidates.length > 1 && (
            <Text dimColor>
              {`  possibilities: ${autocompleteCandidates.join(' · ').slice(0, 120)}`}
            </Text>
          )}
        </Box>
      )}
      {!searchOpen && searchQuery && (
        <Box marginTop={1}>
          <Text dimColor>{`/${searchQuery}  (${totalMatches}/${totalComponents} matches) · [Esc] clear`}</Text>
        </Box>
      )}

      <Box columnGap={2} marginTop={1} flexWrap="wrap">
        {includedCount > 0 ? (
          <Text>
            <Text color={PALETTE.success}>{includedCount}</Text>
            <Text dimColor>/{totalComponents} included</Text>
          </Text>
        ) : (
          <Text color={PALETTE.warning}>none included</Text>
        )}
        {legendEntry('[j/k]', 'move')}
        {legendEntry('[a]', 'accept')}
        {legendEntry('[r]', 'reject')}
        {hasGroupRoots && legendEntry('[space]', 'expand/collapse group')}
        {hasGroupRoots && legendEntry('[E/C]', 'expand/collapse all')}
        {legendEntry('[A]', 'toggle all')}
        {legendEntry('[Y]', 'accept non-flagged')}
        {legendEntry('[L]', 'flat', columnOneView === 'flat')}
        {legendEntry('[l]', 'lineage', lineagePanel.isOpen)}
        {legendEntry('[i]', 'focus lineage', jumpFilterTarget !== null)}
        {hasCycles && legendEntry('[o]', 'only cycles', activeFilters.has('cycles'))}
        {hasCycles && legendEntry('[c]', 'cycle list', cyclesPanelOpen)}
        {legendEntry('[/]', 'search', searchOpen || searchQuery.length > 0)}
        {legendEntry('[f]', 'continue')}
        {legendEntry('[?]', 'help')}
        {legendEntry('[q]', 'quit')}
        {columnPlan.layout === 'three-column' && legendEntry('[Tab/Shift-Tab]', 'switch column')}
        {columnPlan.layout === 'three-column' && legendEntry('[Enter]', 'jump to main')}
        {hasAnyAi && legendEntry('[x]', 'AI exclusions', aiRationalePanel.isOpen)}
        {hasAnyAi && (
          <Text>
            <Text color={PALETTE.warning} bold>[×]</Text> <Text dimColor>AI recommends excluding</Text>
          </Text>
        )}
      </Box>
    </Box>
  );
}

function ColumnHeader(props: { title: string; width: number; focused: boolean }): React.ReactElement {
  const { title, width, focused } = props;
  const sep = '─'.repeat(Math.max(0, width - 2));
  return (
    <Box flexDirection="column">
      <Text bold color={focused ? PALETTE.inverse : PALETTE.info} inverse={focused}>
        {title}
      </Text>
      <Text dimColor>{sep}</Text>
    </Box>
  );
}

export function sideColumnLabelStyle(input: {
  isCycle: boolean;
  isSelected: boolean;
  focused: boolean;
}): {
  nameColor: string | undefined;
  nameBold: boolean;
  nameInverse: boolean;
  nameUnderline: boolean;
  suffixColor: string | undefined;
  suffixDim: boolean;
  suffixInverse: boolean;
  suffixUnderline: boolean;
} {
  const { isCycle, isSelected, focused } = input;
  const isCursor = isSelected && focused;
  if (isCursor) {
    return {
      nameColor: PALETTE.inverse,
      nameBold: true,
      nameInverse: true,
      nameUnderline: false,
      suffixColor: PALETTE.inverse,
      suffixDim: false,
      suffixInverse: true,
      suffixUnderline: false,
    };
  }
  const underline = isSelected && !focused;
  if (isCycle) {
    return {
      nameColor: PALETTE.warning,
      nameBold: false,
      nameInverse: false,
      nameUnderline: underline,
      suffixColor: PALETTE.warning,
      suffixDim: false,
      suffixInverse: false,
      suffixUnderline: underline,
    };
  }
  return {
    nameColor: PALETTE.success,
    nameBold: false,
    nameInverse: false,
    nameUnderline: underline,
    suffixColor: PALETTE.info,
    suffixDim: true,
    suffixInverse: false,
    suffixUnderline: underline,
  };
}

export function computeColumnWindow(
  total: number,
  cursor: number,
  visibleCount: number,
): { start: number; end: number; above: number; below: number } {
  if (total <= visibleCount) return { start: 0, end: total, above: 0, below: 0 };
  let start = Math.max(0, cursor - Math.floor(visibleCount / 2));
  start = Math.min(start, total - visibleCount);
  const end = start + visibleCount;
  return { start, end, above: start, below: total - end };
}

function AddedComponentsColumn(props: {
  width: number;
  entries: AddedComponentEntry[];
  cursor: number;
  focused: boolean;
  aiFlaggedByKey?: Map<string, boolean>;
  visibleCount: number;
}): React.ReactElement {
  const { width, entries, cursor, focused, aiFlaggedByKey, visibleCount } = props;
  const reserveAiBadge = entries.some((e) => aiFlaggedByKey?.get(e.name) === true);
  const firstNonCycleIdx = entries.findIndex((e) => !e.isCycle);
  const window = computeColumnWindow(entries.length, cursor, Math.max(1, visibleCount));
  return (
    <Box
      flexDirection="column"
      width={width}
      flexShrink={0}
      borderStyle="single"
      borderColor={focused ? PALETTE.inverse : undefined}
    >
      <ColumnHeader title="Added components" width={width} focused={focused} />
      {entries.length === 0 ? (
        <Text dimColor>(none)</Text>
      ) : (
        <>
        {window.above > 0 && <Text dimColor>{`↑ ${window.above} more`}</Text>}
        {entries.slice(window.start, window.end).map((entry, vi) => {
          const i = window.start + vi;
          const isSelected = i === cursor;
          const isCursor = focused && isSelected;
          const aiFlagged = aiFlaggedByKey?.get(entry.name) === true;
          const showSeparator = firstNonCycleIdx > 0 && i === firstNonCycleIdx;
          const style = sideColumnLabelStyle({
            isCycle: entry.isCycle,
            isSelected,
            focused,
          });
          return (
            <React.Fragment key={entry.name}>
              {showSeparator && (
                <Text dimColor>{'─'.repeat(Math.max(0, width - 2))}</Text>
              )}
              <Box>
                {isCursor ? (
                  <Text color={PALETTE.info} bold>
                    {'▶'}
                  </Text>
                ) : (
                  <Text> </Text>
                )}
                {reserveAiBadge && (
                  aiFlagged ? (
                    <Text color={PALETTE.warning} bold>
                      {' [×]'}
                    </Text>
                  ) : (
                    <Text>{'    '}</Text>
                  )
                )}
                {entry.isCycle && (
                  <Text
                    color={isCursor ? PALETTE.inverse : PALETTE.warning}
                    bold
                    inverse={isCursor}
                    underline={style.nameUnderline}
                  >
                    {' ⚠'}
                  </Text>
                )}
                <Text
                  color={style.nameColor}
                  bold={style.nameBold}
                  inverse={style.nameInverse}
                  underline={style.nameUnderline}
                  wrap="truncate"
                >
                  {' ' + entry.name}
                </Text>
              </Box>
            </React.Fragment>
          );
        })}
        {window.below > 0 && <Text dimColor>{`↓ ${window.below} more`}</Text>}
        </>
      )}
    </Box>
  );
}

function AddedGroupsColumn(props: {
  width: number;
  entries: AddedGroupEntry[];
  cursor: number;
  focused: boolean;
  aiFlaggedByKey?: Map<string, boolean>;
  visibleCount: number;
}): React.ReactElement {
  const { width, entries, cursor, focused, aiFlaggedByKey, visibleCount } = props;
  const reserveAiBadge = entries.some((g) => aiFlaggedByKey?.get(g.name) === true);
  const firstNonCycleIdx = entries.findIndex((e) => !e.isCycle);
  const window = computeColumnWindow(entries.length, cursor, Math.max(1, visibleCount));
  return (
    <Box
      flexDirection="column"
      width={width}
      flexShrink={0}
      borderStyle="single"
      borderColor={focused ? PALETTE.inverse : undefined}
    >
      <ColumnHeader title="Added groups" width={width} focused={focused} />
      {entries.length === 0 ? (
        <Text dimColor>(none)</Text>
      ) : (
        <>
        {window.above > 0 && <Text dimColor>{`↑ ${window.above} more`}</Text>}
        {entries.slice(window.start, window.end).map((g, vi) => {
          const i = window.start + vi;
          const isSelected = i === cursor;
          const isCursor = focused && isSelected;
          const suffix = ` (${g.depCount} dep${g.depCount === 1 ? '' : 's'})`;
          const aiFlagged = aiFlaggedByKey?.get(g.name) === true;
          const showSeparator = firstNonCycleIdx > 0 && i === firstNonCycleIdx;
          const style = sideColumnLabelStyle({
            isCycle: g.isCycle,
            isSelected,
            focused,
          });
          return (
            <React.Fragment key={g.name}>
              {showSeparator && (
                <Text dimColor>{'─'.repeat(Math.max(0, width - 2))}</Text>
              )}
              <Box>
                {isCursor ? (
                  <Text color={PALETTE.info} bold>
                    {'▶'}
                  </Text>
                ) : (
                  <Text> </Text>
                )}
                {reserveAiBadge && (
                  aiFlagged ? (
                    <Text color={PALETTE.warning} bold>
                      {' [×]'}
                    </Text>
                  ) : (
                    <Text>{'    '}</Text>
                  )
                )}
                {g.isCycle && (
                  <Text
                    color={isCursor ? PALETTE.inverse : PALETTE.warning}
                    bold
                    inverse={isCursor}
                    underline={style.nameUnderline}
                  >
                    {' ⚠'}
                  </Text>
                )}
                <Text
                  color={style.nameColor}
                  bold={style.nameBold}
                  inverse={style.nameInverse}
                  underline={style.nameUnderline}
                  wrap="truncate"
                >
                  {' ' + g.name}
                </Text>
                <Text
                  color={style.suffixColor}
                  dimColor={style.suffixDim}
                  inverse={style.suffixInverse}
                  underline={style.suffixUnderline}
                  bold={style.nameBold}
                  wrap="truncate"
                >
                  {suffix}
                </Text>
              </Box>
            </React.Fragment>
          );
        })}
        {window.below > 0 && <Text dimColor>{`↓ ${window.below} more`}</Text>}
        </>
      )}
    </Box>
  );
}

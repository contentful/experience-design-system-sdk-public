import { Box, Text } from 'ink';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import figures from 'figures';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';
import {
  GroupedSidebar,
  buildVisibleRows,
  type GroupedSidebarItem,
} from '../../../analyze/select/tui/components/GroupedSidebar.js';
import { computeAllClosures, type ComponentGraphNode, type NodeStatus } from '../../../analyze/composite-closure.js';
import { buildComponentGraph } from '../../../analyze/slot-graph.js';
import { findSlotCycles, type SlotCycle } from '../../../analyze/cycle-detection.js';
import { buildFlatDimPredicate, computeFilterKeys, intersectFilterKeys } from '../step-filters.js';
import { createSidebarViewsHelpSection } from '../sidebar-help.js';
import { handleSidebarSearchInput } from '../sidebar-input.js';
import { collectExpandedGroupRoots, computeSidebarViewToggle } from '../sidebar-navigation.js';
import { useSidebarSearchState } from '../hooks/sidebar-search-state.js';
import { SearchMatchSummary } from '../components/SearchMatchSummary.js';
import { useOverlayPanel } from '../hooks/useOverlayPanel.js';
import { computeSidebarBudget, FALLBACK_ROWS } from '../lineage-layout.js';
import { useTerminalSize } from '../../../tui/use-terminal-size.js';
import { GotoBanner } from '../../../analyze/select/tui/components/GotoBanner.js';
import { HelpOverlay, type HelpSection } from '../../../analyze/select/tui/components/HelpOverlay.js';
import { CompactControlBar } from '../components/CompactControlBar.js';
import { CounterStrip } from '../components/CounterStrip.js';
import { isAiFlagged } from '../ai-flag.js';
import { resolveGroupRoot } from '../group-collapse.js';
import { WindowIndicator, WindowedPanel } from '../../../tui/windowed-panel.js';
import {
  buildCycleUnits,
  collectReachableCycleUnits,
  computeCycleAwareAcceptCascade,
  computeCycleAwareRejectCascade,
} from '../../../analyze/scope-gate-cascade.js';
import { fuzzyMatches } from '../../../analyze/fuzzy-search.js';
import { computeDirectNeighborhood, findAllAncestors } from '../../../analyze/search-neighborhood.js';
import {
  buildAddedComponentsList,
  computeColumnWidths,
  computePanelLayout,
  computeCounters,
  type AddedComponentEntry,
} from '../scope-gate-columns.js';

export type ScopeComponent = {
  name: string;
  componentId: string;
  aiDecision?: 'accepted' | 'rejected' | 'failed' | null;
  aiReason?: string | null;
  needsReview?: boolean;
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

const HELP_SECTIONS: HelpSection[] = [
  {
    title: 'Navigation',
    entries: [
      { keys: '↑ / ↓', label: 'Move cursor' },
      { keys: 'Tab / Shift-Tab', label: 'Switch column' },
      { keys: 'Enter', label: 'Jump to row in main column' },
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
  createSidebarViewsHelpSection(false),
  {
    title: 'Panels',
    entries: [
      { keys: 'c', label: 'Cycle list' },
      { keys: 'd', label: 'Show slot dependencies in main list' },
      { keys: 'x', label: 'Review flags' },
    ],
  },
  {
    title: 'Search',
    entries: [{ keys: '/', label: 'Search' }],
  },
  {
    title: 'General',
    entries: [
      { keys: 'f', label: 'Continue' },
      { keys: 'h', label: 'Close help' },
      { keys: 'q', label: 'Quit' },
    ],
  },
];

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

export function ScopeGateStep(props: ScopeGateStepProps): React.ReactElement {
  if (props.components.length === 0) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text color={PALETTE.error}>Error: no components found for this session — please re-run analyze extract.</Text>
      </Box>
    );
  }

  return <ScopeGateStepView {...props} components={[...props.components]} />;
}

function ScopeGateStepView({
  components,
  onConfirm,
  onQuit,
}: Omit<ScopeGateStepProps, 'components'> & { components: ScopeComponent[] }): React.ReactElement {
  const { columns: totalWidth, rows: terminalRows } = useTerminalSize();
  const columnPlan = useMemo(() => computeColumnWidths(totalWidth), [totalWidth]);
  const sidebarWidth = columnPlan.main;
  type Decision = 'accepted' | 'rejected' | 'undecided';
  const [userDecisions, setUserDecisions] = useState<Map<string, Decision>>(new Map());
  const [nav, setNav] = useState<{ cursor: number; scrollOffset: number }>({ cursor: 0, scrollOffset: 0 });
  type FocusedColumn = 'main' | 'added-components';
  const [focusedColumn, setFocusedColumn] = useState<FocusedColumn>('main');
  const [addedComponentsCursor, setAddedComponentsCursor] = useState(0);
  const [showDependencies, setShowDependencies] = useState(false);
  const cursor = nav.cursor;
  const scrollOffset = nav.scrollOffset;
  const [cyclesPanelOpen, setCyclesPanelOpen] = useState(false);
  const [cyclesCursor, setCyclesCursor] = useState(0);
  const aiRationalePanel = useOverlayPanel({ toggleKey: 'x' });
  const [aiCursor, setAiCursor] = useState(0);
  const [pendingRejectCascade, setPendingRejectCascade] = useState<{
    target: string;
    ancestors: string[];
    descendants: string[];
  } | null>(null);
  const {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    autocompleteCandidates,
    setAutocompleteCandidates,
    jumpFilterTarget,
    setJumpFilterTarget,
    columnOneView,
    setColumnOneView,
    activeFilters,
    setActiveFilters,
    showHelp,
    setShowHelp,
  } = useSidebarSearchState();

  const getState = (name: string): Decision => {
    const v = userDecisions.get(name);
    return v ?? 'undecided';
  };

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

  const graph: ComponentGraphNode[] = useMemo(() => buildComponentGraph(groupedItems), [groupedItems]);

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

  const dependencyFilterKeys = useMemo<Set<string> | undefined>(() => {
    if (!showDependencies) return undefined;
    const keys = new Set<string>();
    for (const [root, closure] of closures) {
      if (closure.nodes.length <= 1 || getState(root) !== 'accepted') continue;
      for (const node of closure.nodes) keys.add(node.name);
    }
    for (const unit of cycleUnits.values()) {
      if (![...unit].some((name) => getState(name) === 'accepted')) continue;
      for (const name of unit) keys.add(name);
    }
    return keys;
  }, [closures, cycleUnits, showDependencies, userDecisions]);

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
      const matches = groupedItems.map((it) => it.key).filter((k) => fuzzyMatches(searchQuery, k));
      if (matches.length === 0) return undefined;
      return computeDirectNeighborhood(matches, graph);
    })();
    return intersectFilterKeys(intersectFilterKeys(categoryKeys, searchKeys), dependencyFilterKeys);
  }, [
    jumpFilterTarget,
    activeFilters,
    cycleParticipants,
    brokenKeys,
    searchQuery,
    groupedItems,
    graph,
    dependencyFilterKeys,
  ]);

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
  const currentRowKey = currentRow && currentRow.itemIdx >= 0 ? groupedItems[currentRow.itemIdx]?.key : undefined;

  const selectionStateByKey = useMemo(() => {
    const map = new Map<string, 'accepted' | 'rejected' | 'undecided'>();
    for (const c of components) {
      map.set(c.name, getState(c.name));
    }
    return map;
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
    const { toReject, toDeselect } = computeCycleAwareRejectCascade(target, graph, cycleUnits);
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
    const { toReject, toDeselect } = computeCycleAwareRejectCascade(name, graph, cycleUnits);
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

  const { sidebarVisibleCount: visibleCount, panelMaxRows } = computeSidebarBudget({
    rows: terminalRows || FALLBACK_ROWS,
    panelOpen: false,
    entryCount: 0,
  });
  const panelLayout = useMemo(() => computePanelLayout(visibleCount), [visibleCount]);

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
    if (showHelp) {
      if (input === 'h' || key.escape) setShowHelp(false);
      return;
    }

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
        const cursorItemName = cursorRow && cursorRow.itemIdx >= 0 ? groupedItems[cursorRow.itemIdx]?.key : undefined;
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
      if (
        handleSidebarSearchInput(input, key, {
          query: searchQuery,
          names: components.map((c) => c.name),
          setQuery: setSearchQuery,
          setCandidates: setAutocompleteCandidates,
        })
      )
        return;
      return;
    }

    if (cyclesPanelOpen) {
      if (key.escape || input === 'c') {
        setCyclesPanelOpen(false);
        return;
      }
      if (key.upArrow) {
        setCyclesCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow) {
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

    if (aiRationalePanel.isOpen) {
      if (aiRationalePanel.handleInput(input, key)) return;
      if (key.upArrow) {
        setAiCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow) {
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
    if (input === 'h') {
      setShowHelp(true);
      return;
    }
    if (input === 'f' || input === 'F') {
      onConfirm(partition());
      return;
    }
    if (input === 'c') {
      if (!hasCycles) return;
      setCyclesPanelOpen(true);
      setCyclesCursor(0);
      aiRationalePanel.close();
      return;
    }
    if (input === 'd') {
      setShowDependencies((current) => !current);
      setNav({ cursor: 0, scrollOffset: 0 });
      return;
    }
    if (input === 'x') {
      if (aiRows.length === 0) return;
      aiRationalePanel.open();
      setAiCursor(0);
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
      const targetKey = focusedColumn === 'main' ? focusedRowKey() : addedComponents[safeAddedComponentsCursor]?.name;
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
      setExpandedGroups(collectExpandedGroupRoots(closures, cycleParticipants));
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
      const key = focusedRowKey();
      if (!key) return;
      if (isReject) requestReject(key);
      else requestAccept(key);
      return;
    }
    if (input === 'L') {
      const next = computeSidebarViewToggle({
        currentView: columnOneView,
        currentKey: currentRowKey,
        currentScroll: scrollOffset,
        visibleCount,
        items: groupedItems,
        cycleParticipants,
        expandedGroups,
        graph,
      });
      setColumnOneView(next.view);
      setNav({ cursor: next.cursor, scrollOffset: next.scroll });
      return;
    }
    if (input === 'A') {
      const nonCycle = components.filter((c) => !cycleParticipants.has(c.name)).map((c) => c.name);
      const anyNotAccepted = nonCycle.some((n) => getState(n) !== 'accepted');
      const target: Decision = anyNotAccepted ? 'accepted' : 'rejected';
      if (target === 'accepted') {
        const cyclesToInclude = collectReachableCycleUnits(nonCycle, graph, cycleUnits);
        const entries: Array<[string, Decision]> = nonCycle.map((n) => [n, 'accepted'] as [string, Decision]);
        for (const n of cyclesToInclude) entries.push([n, 'accepted']);
        applyDecisions(entries);
      } else {
        const entries: Array<[string, Decision]> = nonCycle.map((n) => [n, 'rejected'] as [string, Decision]);
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
      const seeds = components.filter((c) => !cycleParticipants.has(c.name) && !isAiFlagged(c)).map((c) => c.name);
      const cyclesToInclude = collectReachableCycleUnits(seeds, graph, cycleUnits);
      const entries: Array<[string, Decision]> = seeds.map((n) => [n, 'accepted'] as [string, Decision]);
      for (const n of cyclesToInclude) entries.push([n, 'accepted']);
      applyDecisions(entries);
      return;
    }
    if (key.tab) {
      if (columnPlan.layout === 'single') return;
      const forward: FocusedColumn[] = ['main', 'added-components'];
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
      return;
    }
    if (key.upArrow) {
      if (focusedColumn === 'added-components') {
        if (addedComponents.length === 0) return;
        setAddedComponentsCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (total === 0) return;
      setNav(({ cursor: c, scrollOffset: prev }) => {
        const next = c <= 0 ? 0 : c - 1;
        return { cursor: next, scrollOffset: Math.min(prev, next) };
      });
      return;
    }
    if (key.downArrow) {
      if (focusedColumn === 'added-components') {
        if (addedComponents.length === 0) return;
        setAddedComponentsCursor((c) => Math.min(addedComponents.length - 1, c + 1));
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

  const selectedItemIdx = currentRow && currentRow.itemIdx >= 0 ? currentRow.itemIdx : -1;

  const totalComponents = components.length;
  const totalMatches = searchQuery ? searchMatches.length : 0;

  const addedComponents = useMemo(
    () => buildAddedComponentsList(components, selectionStateByKey, cycleParticipants),
    [components, selectionStateByKey, cycleParticipants],
  );
  const counters = useMemo(
    () => computeCounters(components, closures, selectionStateByKey),
    [components, closures, selectionStateByKey],
  );

  const safeAddedComponentsCursor = Math.min(addedComponentsCursor, Math.max(0, addedComponents.length - 1));
  if (showHelp) {
    return <HelpOverlay sections={HELP_SECTIONS} handleInput={false} onClose={() => setShowHelp(false)} />;
  }

  return (
    <Box flexDirection="column" paddingX={2}>
      {hasAnyAi && (
        <Box>
          <Text dimColor>
            {`${aiExcludedCount} component${aiExcludedCount === 1 ? '' : 's'} flagged by AI`}
            {aiRows.length > 0 && <Text color={PALETTE.info}>{' — press [x] to see why'}</Text>}
          </Text>
        </Box>
      )}

      <CounterStrip counters={counters} totalWidth={totalWidth} />

      {hasCycles && (
        <Box marginTop={1}>
          <Text dimColor>
            If you must have components with cycles, select them together into the generate step and then use the editor
            to fix them.
          </Text>
        </Box>
      )}

      <Box flexDirection="row" alignItems="stretch">
        {aiRationalePanel.isOpen ? (
          <GotoBanner
            title={`Review flags (${aiExcludedCount})`}
            rows={aiRows}
            cursor={aiCursor}
            maxRows={panelMaxRows}
            width={sidebarWidth}
            footerHint="[↑/↓] move · [Enter] jump · [x/Esc] close"
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
            height={panelLayout.height}
            title="All components"
            wrapLabels
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
        {columnPlan.layout === 'two-column' && (
          <>
            <Box width={2} flexShrink={0} />
            <AddedComponentsColumn
              width={columnPlan.added}
              entries={addedComponents}
              cursor={safeAddedComponentsCursor}
              focused={focusedColumn === 'added-components'}
              height={panelLayout.height}
              title={`Accepted Components (${counters.accepted}/${counters.total})`}
              aiFlaggedByKey={aiFlaggedByKey}
              visibleCount={panelLayout.sideVisibleCount}
            />
          </>
        )}
      </Box>

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
                  <Text color={PALETTE.info} bold>
                    {figures.pointer}
                  </Text>
                ) : (
                  <Text> </Text>
                )}
                <Text color={PALETTE.warning} inverse={isCursor}>
                  {' ' + label}
                </Text>
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
            <Text>{`- Reject ancestors: ${pendingRejectCascade.ancestors.join(', ')}`}</Text>
          )}
          {pendingRejectCascade.descendants.length > 0 && (
            <Text>{`- Deselect descendants: ${pendingRejectCascade.descendants.join(', ')}`}</Text>
          )}
          <Text dimColor>[y] confirm · [n]/[Esc] cancel</Text>
        </Box>
      )}

      <SearchMatchSummary
        open={searchOpen}
        query={searchQuery}
        matches={totalMatches}
        total={totalComponents}
        autocompleteCandidates={autocompleteCandidates}
        marginTop={1}
      />

      <CompactControlBar hasGroupRoots={hasGroupRoots} searchActive={searchOpen || searchQuery.length > 0} />
    </Box>
  );
}

export function sideColumnLabelStyle(input: { isCycle: boolean; isSelected: boolean; focused: boolean }): {
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
      nameColor: PALETTE.info,
      nameBold: true,
      nameInverse: false,
      nameUnderline: false,
      suffixColor: PALETTE.info,
      suffixDim: false,
      suffixInverse: false,
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

type AddedColumnEntry = { name: string; isCycle: boolean };

type AddedColumnProps<T extends AddedColumnEntry> = {
  title: string;
  width: number;
  height: number;
  entries: T[];
  cursor: number;
  focused: boolean;
  aiFlaggedByKey?: Map<string, boolean>;
  visibleCount: number;
  renderSuffix?: (entry: T, style: ReturnType<typeof sideColumnLabelStyle>) => React.ReactNode;
};

function AddedColumn<T extends AddedColumnEntry>(props: AddedColumnProps<T>): React.ReactElement {
  const { title, width, height, entries, cursor, focused, aiFlaggedByKey, visibleCount, renderSuffix } = props;
  const reserveAiBadge = entries.some((e) => aiFlaggedByKey?.get(e.name) === true);
  const firstNonCycleIdx = entries.findIndex((e) => !e.isCycle);
  const window = computeColumnWindow(entries.length, cursor, Math.max(1, visibleCount));
  return (
    <WindowedPanel width={width} height={height} title={title} focused={focused}>
      <WindowIndicator direction="up" count={window.above} />
      {entries.length === 0 ? (
        <Text dimColor>(none)</Text>
      ) : (
        entries.slice(window.start, window.end).map((entry, vi) => {
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
              {showSeparator && <Text dimColor>{'─'.repeat(Math.max(0, width - 2))}</Text>}
              <Box>
                {isCursor ? (
                  <Text color={PALETTE.info} bold>
                    {figures.pointer}
                  </Text>
                ) : (
                  <Text> </Text>
                )}
                {reserveAiBadge &&
                  (aiFlagged ? (
                    <Text color={PALETTE.warning} bold>
                      {' [×]'}
                    </Text>
                  ) : (
                    <Text>{'    '}</Text>
                  ))}
                {entry.isCycle && (
                  <Text
                    color={isCursor ? PALETTE.info : PALETTE.warning}
                    bold
                    inverse={false}
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
                  wrap="wrap"
                >
                  {' ' + entry.name}
                </Text>
                {renderSuffix?.(entry, style)}
              </Box>
            </React.Fragment>
          );
        })
      )}
      <WindowIndicator direction="down" count={window.below} />
    </WindowedPanel>
  );
}

function AddedComponentsColumn(props: {
  width: number;
  height: number;
  title: string;
  entries: AddedComponentEntry[];
  cursor: number;
  focused: boolean;
  aiFlaggedByKey?: Map<string, boolean>;
  visibleCount: number;
}): React.ReactElement {
  return <AddedColumn {...props} />;
}

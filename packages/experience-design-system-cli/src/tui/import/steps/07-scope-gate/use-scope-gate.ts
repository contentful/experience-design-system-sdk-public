import { useEffect, useMemo, useRef, useState } from 'react';
import { buildAddedComponentsList, computeColumnWidths, computeCounters, computePanelLayout } from './columns.js';
import { findAllAncestors } from './graph/search-neighborhood.js';
import { computeDirectNeighborhood } from './graph/search-neighborhood.js';
import { fuzzyMatches } from './graph/fuzzy-search.js';
import { buildRelationshipNodes, buildScopeGraph, rejectCascade, sidebarItems } from './graph/index.js';
import { computeClosure } from './graph/composite-closure.js';
import { resolveKey, type GateAction, type GateContext, type GateMode } from './keymap.js';
import { isAiFlagged } from './sidebar/ai-flag.js';
import { buildVisibleRows } from './sidebar/components/GroupedSidebar.js';
import { resolveGroupRoot } from './sidebar/group-collapse.js';
import { useSidebarSearchState } from './sidebar/hooks/sidebar-search-state.js';
import { useImmediateInput } from './sidebar/hooks/useImmediateInput.js';
import { useOverlayPanel } from './sidebar/hooks/useOverlayPanel.js';
import { useTerminalSize } from './sidebar/hooks/use-terminal-size.js';
import { computeSidebarBudget, FALLBACK_ROWS } from './sidebar/lineage-layout.js';
import { collectExpandedGroupRoots, computeSidebarViewToggle } from './sidebar/sidebar-navigation.js';
import { handleSidebarSearchInput } from './sidebar/sidebar-input.js';
import {
  buildFlatDimPredicate,
  computeFilterKeys,
  describeEmptyFilter,
  intersectFilterKeys,
} from './sidebar/step-filters.js';
import {
  createDecisionState,
  partitionDecisions,
  rejectNeedsConfirmation,
  reduceDecisions,
  type DecisionState,
} from './state.js';
import type { ScopeComponent, ScopeDecisions } from './types.js';

// The state and the key handling of the gate. Everything legacy kept in one 1,064-line component, except what is drawn:
// the reducer (state.ts) decides what a decision changes, the keymap (keymap.ts) what a key means, and this hook puts
// the two together with the cursor, the panels and the search.

interface UseScopeGateOptions {
  components: ScopeComponent[];
  savedDecisions?: ScopeDecisions;
  onConfirm: (decisions: ScopeDecisions) => void;
  onQuit: () => void;
}

type FocusedColumn = 'main' | 'added-components';

export interface PendingRejectCascade {
  target: string;
  ancestors: string[];
  descendants: string[];
}

export function useScopeGate({ components, savedDecisions, onConfirm, onQuit }: UseScopeGateOptions) {
  const { columns: totalWidth, rows: terminalRows } = useTerminalSize();
  const columnPlan = useMemo(() => computeColumnWidths(totalWidth), [totalWidth]);

  const [decisions, setDecisions] = useState<DecisionState>(() => createDecisionState(components, savedDecisions));
  const [nav, setNav] = useState<{ cursor: number; scrollOffset: number }>({ cursor: 0, scrollOffset: 0 });
  const [focusedColumn, setFocusedColumn] = useState<FocusedColumn>('main');
  const [addedComponentsCursor, setAddedComponentsCursor] = useState(0);
  const [showDependencies, setShowDependencies] = useState(false);
  const [cyclesPanelOpen, setCyclesPanelOpen] = useState(false);
  const [cyclesCursor, setCyclesCursor] = useState(0);
  const aiRationalePanel = useOverlayPanel({ toggleKey: 'x' });
  const [aiCursor, setAiCursor] = useState(0);
  const [pendingRejectCascade, setPendingRejectCascade] = useState<PendingRejectCascade | null>(null);
  const search = useSidebarSearchState();
  const {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    setAutocompleteCandidates,
    jumpFilterTarget,
    setJumpFilterTarget,
    columnOneView,
    setColumnOneView,
    activeFilters,
    setActiveFilters,
    showHelp,
    setShowHelp,
  } = search;

  const displayNodes = useMemo(() => buildRelationshipNodes(components), [components]);
  const groupedItems = useMemo(() => sidebarItems(components, displayNodes), [components, displayNodes]);
  const graph = useMemo(() => buildScopeGraph(components), [components]);
  const { cycles: slotCycles, cycleParticipants, cycleUnits } = graph;
  const closures = useMemo(
    () =>
      new Map(
        displayNodes
          .filter((node) => node.slots.some((slot) => slot.allowedComponents?.some((target) => target !== node.name)))
          .map((node) => [node.name, computeClosure(node.name, displayNodes)]),
      ),
    [displayNodes],
  );
  const hasCycles = slotCycles.length > 0;
  const cyclesJumpables = useMemo(
    () => slotCycles.map((c, i) => ({ cycleIndex: i, jumpTarget: c.path[0] })),
    [slotCycles],
  );

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

  const brokenKeys = useMemo(() => new Set(components.filter(isAiFlagged).map((c) => c.name)), [components]);

  const dependencyFilterKeys = useMemo<Set<string> | undefined>(() => {
    if (!showDependencies) return undefined;
    const keys = new Set<string>();
    for (const [root, closure] of graph.closures) {
      if (closure.nodes.length <= 1 || decisions.get(root) !== 'accepted') continue;
      for (const node of closure.nodes) keys.add(node.name);
    }
    for (const unit of cycleUnits.values()) {
      if (![...unit].some((name) => decisions.get(name) === 'accepted')) continue;
      for (const name of unit) keys.add(name);
    }
    return keys;
  }, [graph, cycleUnits, showDependencies, decisions]);

  const filterVisibleKeys = useMemo<Set<string> | undefined>(() => {
    if (jumpFilterTarget) return findAllAncestors(jumpFilterTarget, displayNodes);
    const categoryKeys = computeFilterKeys({
      filters: activeFilters,
      data: { cycles: cycleParticipants, broken: brokenKeys },
    });
    const searchKeys = (() => {
      if (!searchQuery) return undefined;
      const matches = groupedItems.map((it) => it.key).filter((k) => fuzzyMatches(searchQuery, k));
      if (matches.length === 0) return undefined;
      return computeDirectNeighborhood(matches, displayNodes);
    })();
    return intersectFilterKeys(intersectFilterKeys(categoryKeys, searchKeys), dependencyFilterKeys);
  }, [
    jumpFilterTarget,
    activeFilters,
    cycleParticipants,
    brokenKeys,
    searchQuery,
    groupedItems,
    displayNodes,
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
        graph: displayNodes,
        edgeLabel: 'relationship',
        filterVisibleKeys,
      }),
    [groupedItems, cycleParticipants, expandedGroups, columnOneView, displayNodes, filterVisibleKeys],
  );

  const emptyMessage =
    visibleRows.length === 0 && filterVisibleKeys !== undefined && !jumpFilterTarget
      ? describeEmptyFilter({ filters: activeFilters, slotDependencies: showDependencies })
      : undefined;

  const total = visibleRows.length;
  const safeCursor = Math.min(nav.cursor, Math.max(0, total - 1));
  const currentRow = visibleRows[safeCursor];
  const currentRowKey = currentRow && currentRow.itemIdx >= 0 ? groupedItems[currentRow.itemIdx]?.key : undefined;

  const selectionStateByKey = useMemo(() => {
    const map = new Map<string, 'accepted' | 'rejected' | 'undecided'>();
    for (const c of components) map.set(c.name, decisions.get(c.name) ?? 'undecided');
    return map;
  }, [components, decisions]);

  const aiFlaggedByKey = useMemo(() => new Map(components.map((c) => [c.name, isAiFlagged(c)])), [components]);

  const dimPredicate = useMemo(
    () => buildFlatDimPredicate({ viewMode: columnOneView, searchQuery, filterVisibleKeys }),
    [columnOneView, searchQuery, filterVisibleKeys],
  );

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

  const aiExcluded = components.filter(isAiFlagged);
  const aiRows = useMemo(
    () =>
      components.flatMap((component) => {
        const reasons = [
          ...(isAiFlagged(component) && component.aiReason ? [component.aiReason] : []),
          ...(component.modelingNotes ?? []),
        ];
        return reasons.length > 0
          ? [{ label: `${component.name} — ${reasons.join(' ')}`, jumpTarget: component.name }]
          : [];
      }),
    [components],
  );

  const addedComponents = useMemo(
    () => buildAddedComponentsList(components, selectionStateByKey, cycleParticipants),
    [components, selectionStateByKey, cycleParticipants],
  );
  const counters = useMemo(
    () => computeCounters(components, closures, selectionStateByKey),
    [components, closures, selectionStateByKey],
  );
  const safeAddedComponentsCursor = Math.min(addedComponentsCursor, Math.max(0, addedComponents.length - 1));

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

  const jumpCursorTo = (name: string): void => {
    let idx = -1;
    for (let i = 0; i < visibleRows.length; i++) {
      const row = visibleRows[i];
      if (row.itemIdx < 0) continue;
      if (groupedItems[row.itemIdx]?.key === name) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return;
    setNav(({ scrollOffset: prev }) => {
      let nextScroll = prev;
      if (idx < prev) nextScroll = idx;
      else if (idx >= prev + visibleCount) nextScroll = idx - visibleCount + 1;
      return { cursor: idx, scrollOffset: nextScroll };
    });
  };

  const decide = (action: Parameters<typeof reduceDecisions>[1]): void =>
    setDecisions((prev) => reduceDecisions(prev, action, components, graph));

  const requestReject = (name: string): void => {
    if (decisions.get(name) === 'rejected') return;
    if (rejectNeedsConfirmation(graph, name, decisions)) {
      const { toReject, toDeselect } = rejectCascade(graph, name);
      setPendingRejectCascade({
        target: name,
        ancestors: toReject.filter((n) => n !== name).sort(),
        descendants: [...toDeselect].sort(),
      });
      return;
    }
    decide({ type: 'reject', name });
  };

  const mode: GateMode = showHelp
    ? 'help'
    : pendingRejectCascade
      ? 'reject-prompt'
      : searchOpen
        ? 'search'
        : cyclesPanelOpen
          ? 'cycles'
          : aiRationalePanel.isOpen
            ? 'flags'
            : 'main';

  const context: GateContext = {
    focusedColumn,
    singleColumn: columnPlan.layout === 'single',
    hasCycles,
    hasFlagReasons: aiRows.length > 0,
    jumpFilterActive: jumpFilterTarget !== null,
    searchActive: searchQuery.length > 0,
    focusedListEmpty: focusedColumn === 'added-components' ? addedComponents.length === 0 : total === 0,
  };

  const submitSearch = (): void => {
    const closeSearch = (): void => {
      setSearchOpen(false);
      setSearchQuery('');
      setAutocompleteCandidates([]);
    };
    if (!searchQuery || searchMatches.length === 0) {
      closeSearch();
      return;
    }
    const cursorName = currentRow && currentRow.itemIdx >= 0 ? groupedItems[currentRow.itemIdx]?.key : undefined;
    const rowName = (i: number): string | undefined => {
      const r = visibleRows[i];
      return r && r.itemIdx >= 0 ? groupedItems[r.itemIdx]?.key : undefined;
    };
    let target: string | undefined;
    for (let i = safeCursor; i < visibleRows.length && !target; i++) {
      const n = rowName(i);
      if (n && n !== cursorName && fuzzyMatches(searchQuery, n)) target = n;
    }
    for (let i = 0; i < visibleRows.length && !target; i++) {
      const n = rowName(i);
      if (n && fuzzyMatches(searchQuery, n)) target = n;
    }
    if (target) jumpCursorTo(target);
    setSearchOpen(false);
  };

  const move = (delta: -1 | 1): void => {
    if (mode === 'cycles') {
      setCyclesCursor((c) => Math.max(0, Math.min(Math.max(0, cyclesJumpables.length - 1), c + delta)));
      return;
    }
    if (mode === 'flags') {
      setAiCursor((c) => Math.max(0, Math.min(Math.max(0, aiRows.length - 1), c + delta)));
      return;
    }
    if (focusedColumn === 'added-components') {
      setAddedComponentsCursor((c) => Math.max(0, Math.min(addedComponents.length - 1, c + delta)));
      return;
    }
    setNav(({ cursor: c, scrollOffset: prev }) => {
      if (delta < 0) {
        const next = c <= 0 ? 0 : c - 1;
        return { cursor: next, scrollOffset: Math.min(prev, next) };
      }
      const next = c >= total - 1 ? total - 1 : c + 1;
      return { cursor: next, scrollOffset: next >= prev + visibleCount ? next - visibleCount + 1 : prev };
    });
  };

  const perform = (action: GateAction): void => {
    switch (action.type) {
      case 'none':
        return;
      case 'quit':
        onQuit();
        return;
      case 'confirm':
        onConfirm(partitionDecisions(components, decisions));
        return;
      case 'close-help':
        setShowHelp(false);
        return;
      case 'answer-reject-prompt':
        if (action.confirm && pendingRejectCascade) decide({ type: 'reject', name: pendingRejectCascade.target });
        setPendingRejectCascade(null);
        return;
      case 'close-panel':
        setCyclesPanelOpen(false);
        return;
      case 'close-search':
        setSearchOpen(false);
        setSearchQuery('');
        setAutocompleteCandidates([]);
        return;
      case 'submit-search':
        submitSearch();
        return;
      case 'search-input':
        return;
      case 'clear-jump-filter':
        setJumpFilterTarget(null);
        return;
      case 'clear-search':
        setSearchQuery('');
        setAutocompleteCandidates([]);
        return;
      case 'move':
        move(action.delta);
        return;
      case 'jump-to-selected':
        if (mode === 'cycles') {
          const target = cyclesJumpables[cyclesCursor];
          if (target) jumpCursorTo(target.jumpTarget);
          setCyclesPanelOpen(false);
        } else if (mode === 'flags') {
          const row = aiRows[aiCursor];
          if (row) jumpCursorTo(row.jumpTarget);
          aiRationalePanel.close();
        } else {
          const entry = addedComponents[safeAddedComponentsCursor];
          if (entry) jumpCursorTo(entry.name);
          setFocusedColumn('main');
        }
        return;
      case 'accept': {
        const key = focusedRowKey();
        if (key) decide({ type: 'accept', name: key });
        return;
      }
      case 'reject': {
        const key =
          focusedColumn === 'added-components' ? addedComponents[safeAddedComponentsCursor]?.name : focusedRowKey();
        if (key) requestReject(key);
        return;
      }
      case 'toggle-all':
        decide({ type: 'toggle-all' });
        return;
      case 'accept-unflagged':
        decide({ type: 'accept-unflagged' });
        return;
      case 'toggle-group': {
        const key = focusedRowKey();
        const rootName = key ? resolveGroupRoot(key, closures, cycleParticipants) : undefined;
        if (rootName) toggleExpanded(rootName);
        return;
      }
      case 'expand-all':
        setExpandedGroups(collectExpandedGroupRoots(closures, cycleParticipants));
        return;
      case 'collapse-all':
        setExpandedGroups(new Set());
        return;
      case 'switch-column': {
        const order: FocusedColumn[] = ['main', 'added-components'];
        const at = order.indexOf(focusedColumn);
        setFocusedColumn(order[(at + action.delta + order.length) % order.length]);
        return;
      }
      case 'open-panel':
        if (action.panel === 'help') setShowHelp(true);
        else if (action.panel === 'search') setSearchOpen(true);
        else if (action.panel === 'cycles') {
          setCyclesPanelOpen(true);
          setCyclesCursor(0);
          aiRationalePanel.close();
        } else {
          aiRationalePanel.open();
          setAiCursor(0);
          setCyclesPanelOpen(false);
        }
        return;
      case 'toggle-dependencies':
        setShowDependencies((current) => !current);
        setNav({ cursor: 0, scrollOffset: 0 });
        return;
      case 'toggle-cycle-filter':
        setActiveFilters((prev) => {
          const next = new Set(prev);
          if (next.has('cycles')) next.delete('cycles');
          else next.add('cycles');
          return next;
        });
        return;
      case 'toggle-jump-filter': {
        const target = focusedColumn === 'main' ? focusedRowKey() : addedComponents[safeAddedComponentsCursor]?.name;
        if (target) setJumpFilterTarget((prev) => (prev === target ? null : target));
        return;
      }
      case 'toggle-view': {
        const next = computeSidebarViewToggle({
          currentView: columnOneView,
          currentKey: currentRowKey,
          currentScroll: nav.scrollOffset,
          visibleCount,
          items: groupedItems,
          cycleParticipants,
          expandedGroups,
          graph: displayNodes,
        });
        setColumnOneView(next.view);
        setNav({ cursor: next.cursor, scrollOffset: next.scroll });
        return;
      }
    }
  };

  useImmediateInput((input, key) => {
    // the flags panel closes itself on its toggle key and Esc before the keymap sees them
    if (mode === 'flags' && aiRationalePanel.handleInput(input, key)) return;
    if (mode === 'search') {
      const action = resolveKey(mode, { input, ...key }, context);
      if (action.type === 'search-input') {
        handleSidebarSearchInput(input, key, {
          query: searchQuery,
          names: components.map((c) => c.name),
          setQuery: setSearchQuery,
          setCandidates: setAutocompleteCandidates,
        });
        return;
      }
      perform(action);
      return;
    }
    perform(resolveKey(mode, { input, ...key }, context));
  });

  return {
    // layout
    totalWidth,
    columnPlan,
    panelLayout,
    visibleCount,
    panelMaxRows,
    // sidebar
    groupedItems,
    graph,
    displayNodes,
    hasGroupRoots,
    hasSourceRelationships: components.some((component) => (component.sourceRelationships?.length ?? 0) > 0),
    expandedGroups,
    toggleExpanded,
    visibleRows,
    emptyMessage,
    safeCursor,
    scrollOffset: nav.scrollOffset,
    selectionStateByKey,
    aiFlaggedByKey,
    dimPredicate,
    columnOneView,
    focusedColumn,
    // panels
    showHelp,
    closeHelp: () => setShowHelp(false),
    cyclesPanelOpen,
    cyclesCursor,
    slotCycles,
    aiRationalePanelOpen: aiRationalePanel.isOpen,
    aiCursor,
    aiRows,
    aiExcludedCount: aiExcluded.length,
    hasAdvisoryNotes: components.some((component) => (component.modelingNotes?.length ?? 0) > 0),
    pendingRejectCascade,
    // added column
    addedComponents,
    safeAddedComponentsCursor,
    counters,
    // search
    search,
    searchMatches,
  };
}

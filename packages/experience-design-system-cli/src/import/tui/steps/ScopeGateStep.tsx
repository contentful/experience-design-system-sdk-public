import { Box, Text, useStdout } from 'ink';
import React, { useMemo, useState } from 'react';
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
  computeFilterKeys,
  intersectFilterKeys,
  type FilterCategory,
} from '../step-filters.js';
import { useLineage } from '../hooks/useLineage.js';
import { useOverlayPanel } from '../hooks/useOverlayPanel.js';
import { computeLineageLayout } from '../lineage-layout.js';
import { LineagePanel } from '../../../analyze/select/tui/components/LineagePanel.js';
import { GotoBanner } from '../../../analyze/select/tui/components/GotoBanner.js';
import { HelpOverlay, type HelpSection } from '../../../analyze/select/tui/components/HelpOverlay.js';
import { legendEntry } from '../components/LegendEntry.js';
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

// T7 — focused-row detail line renders the full AI reason with wrapping,
// capped at 4 lines. Approximate the cap as `width * FOCUSED_REASON_MAX_LINES`
// characters — precise wrap-position is width-dependent so this is intentionally
// generous, and we append an ellipsis when the source exceeds the budget.
const FOCUSED_REASON_MAX_LINES = 4;

// L11 — help groups ordered by WHERE a key is used (navigation → selection →
// sidebar views/filters → panels → search → general). Sidebar-view keys (flat,
// lineage, focus-lineage, broken filter, only-cycles filter) cluster together
// because they all reshape the left column. The two cycle features carry
// DISTINCT labels: `[c]` = "Cycle list" (breakdown panel), `[o]` = "Only cycles"
// (sidebar filter).
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
      { keys: 'a / space', label: 'Accept' },
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
      { keys: 'w', label: 'Only broken' },
      { keys: 'o', label: 'Only cycles' },
    ],
  },
  {
    title: 'Panels',
    entries: [
      { keys: 'c', label: 'Cycle list' },
      { keys: 's', label: 'AI reason' },
      { keys: 'x', label: 'AI exclusions' },
    ],
  },
  {
    title: 'Search',
    entries: [
      { keys: '/', label: 'Search' },
      { keys: 'n', label: 'Next match' },
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

function isAiFlagged(row: ScopeComponent): boolean {
  return row.aiDecision === 'rejected' || row.aiDecision === 'failed';
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
  const [reasonPanelOpen, setReasonPanelOpen] = useState(false);
  // T10 — lineage panel open/close via shared hook. Close-side (`[l]` toggle
  // and `[Esc]`) is delegated; other keystrokes (Tab/Enter/j/k/↑/↓, plus the
  // step-specific `c` cross-to-cycles switch) stay in the caller.
  const lineagePanel = useOverlayPanel({ toggleKey: 'l' });
  const [lineageCursor, setLineageCursor] = useState(0);
  const [cyclesPanelOpen, setCyclesPanelOpen] = useState(false);
  const [cyclesCursor, setCyclesCursor] = useState(0);
  // L7 — AI-rationale goto-banner. Renders in the sidebar slot (like lineage,
  // per L2d) so opening it never grows the frame. Mutually exclusive with the
  // lineage + cycles panels.
  const aiRationalePanel = useOverlayPanel({ toggleKey: 'x' });
  const [aiCursor, setAiCursor] = useState(0);
  const [pendingRejectCascade, setPendingRejectCascade] =
    useState<{ target: string; ancestors: string[]; descendants: string[] } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // L4 — Tab autocomplete possibilities strip. Populated when Tab finds >1
  // prefix-match; cleared on the next keystroke/backspace/close.
  const [autocompleteCandidates, setAutocompleteCandidates] = useState<string[]>([]);
  // T5 — jump-and-filter target. Independent of `searchQuery` so pressing
  // `[i]` doesn't drive fuzzy matching; the two filters are OR-merged into
  // `filterVisibleKeys`. Esc clears jumpFilter first (see input handler).
  const [jumpFilterTarget, setJumpFilterTarget] = useState<string | null>(null);
  const [columnOneView, setColumnOneView] = useState<'grouped' | 'flat'>('grouped');
  // L8 — category filters (broken / cycles). Each is an independent toggle;
  // multiple active filters UNION their key sets. ScopeGate has no "deleted"
  // concept (that's a GenerateReview-only removedComponents notion), so only
  // `broken` and `cycles` are offered here.
  const [activeFilters, setActiveFilters] = useState<Set<FilterCategory>>(new Set());
  const [showHelp, setShowHelp] = useState(false);

  // Everything defaults to undecided. AI decisions are advisory only —
  // surfaced via the [×] badge and the recommends-exclusions banner, never
  // auto-applied. The operator explicitly opts each component in via
  // [a]/[space] or [Y]/[A] bulk-accept.
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

  // ADR-0010 Part 3 / plan §4.4: build the graph via the canonical
  // `buildComponentGraph` helper. No `stripRejectedEdges` at scope-gate —
  // "rejected" here means "excluded from generation scope," and a rejected
  // component's slot references are still meaningful to cycle detection
  // (that's the whole reason to send them to generate). Cycles are expected
  // pre-generation, not push-blocking.
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

  // Cycle-unit lookup: any cycle member → the union of every cycle it
  // participates in (transitively via shared nodes). Non-cycle components
  // are absent. Wraps `selection-cascade` at the callsite to enforce
  // cycle-unit cohesion (see `analyze/scope-gate-cascade.ts`).
  const cycleUnits = useMemo(() => buildCycleUnits(slotCycles), [slotCycles]);

  // Flat, walkable list of cycle-participant jump targets. One entry per
  // cycle — Enter jumps the main cursor to the first component in the
  // cycle's path (its canonical "root" per Johnson's least-vertex ordering).
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

  // L8 — "broken" in ScopeGate = AI-flagged (rejected/failed). Component keys
  // feeding the `broken` category filter.
  const brokenKeys = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    for (const c of components) if (isAiFlagged(c)) set.add(c.name);
    return set;
  }, [components]);

  const filterVisibleKeys = useMemo<Set<string> | undefined>(() => {
    // T5: jump-filter takes priority. When active, the sidebar shows only the
    // target + its transitive ancestors — search-neighborhood + category
    // filters are set aside until Esc clears the jump.
    if (jumpFilterTarget) {
      return findAllAncestors(jumpFilterTarget, graph);
    }
    // L8: category filters (broken / cycles) → union of matching keys.
    const categoryKeys = computeFilterKeys({
      filters: activeFilters,
      data: { cycles: cycleParticipants, broken: brokenKeys },
    });
    // Search-neighborhood key set (undefined when no query / no match).
    const searchKeys = (() => {
      if (!searchQuery) return undefined;
      const matches = groupedItems
        .map((it) => it.key)
        .filter((k) => fuzzyMatches(searchQuery, k));
      if (matches.length === 0) return undefined;
      return computeDirectNeighborhood(matches, graph);
    })();
    // Precedence: jump (above) → category ∩ search → whichever is active.
    // When both a category filter and search are active, INTERSECT so only
    // components satisfying BOTH survive; either alone applies on its own.
    return intersectFilterKeys(categoryKeys, searchKeys);
  }, [jumpFilterTarget, activeFilters, cycleParticipants, brokenKeys, searchQuery, groupedItems, graph]);

  const visibleRows = useMemo(
    () =>
      buildVisibleRows({
        items: groupedItems,
        cycleParticipants,
        expandedGroups: new Set(),
        alwaysExpanded: true,
        showFlatTier: false,
        viewMode: columnOneView,
        graph,
        filterVisibleKeys,
      }),
    [groupedItems, cycleParticipants, columnOneView, graph, filterVisibleKeys],
  );

  const total = visibleRows.length;
  const safeCursor = Math.min(cursor, Math.max(0, total - 1));

  const currentRow = visibleRows[safeCursor];
  const currentRowKey =
    currentRow && currentRow.itemIdx >= 0 ? groupedItems[currentRow.itemIdx]?.key : undefined;
  const focusedComponent = currentRowKey
    ? components.find((c) => c.name === currentRowKey)
    : undefined;

  // Selection state map for GroupedSidebar rendering (D1: per-row glyphs).
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

  const dimPredicate = useMemo(() => {
    if (!searchQuery) return undefined;
    return (name: string) => !fuzzyMatches(searchQuery, name);
  }, [searchQuery]);

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
    // "Ancestors" for the confirm prompt = everything flipping to rejected
    // except the target itself. This includes cycle partners in the target's
    // unit, transitive slot-ancestors, and any cycle-unit ancestors along the
    // way — collectively the blast-up radius. `descendants` = everything
    // being deselected to undecided.
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
      // Only affirmatively accepted rows are in scope; undecided → rejected.
      if (getState(c.name) === 'accepted') accepted.push(c.name);
      else rejected.push(c.name);
    }
    return { accepted, rejected };
  };

  // Lineage panel entries for the focused component. Shared with
  // GenerateReviewStep via the `useLineage` hook — see
  // `src/import/tui/hooks/useLineage.ts`.
  const { entries: lineageEntries, jumpables: lineageJumpables } = useLineage(
    focusedComponent?.name ?? null,
    graph,
  );

  // L2c — height-aware layout. When the lineage panel is open the sidebar
  // shrinks and the panel's window is sized from the remaining rows so the
  // total frame fits `stdout.rows` and Ink never full-repaints (the flash).
  // Closed → full sidebar height. Scroll-follow math below uses `visibleCount`
  // so the cursor stays inside the (possibly shrunk) window.
  const { sidebarVisible: visibleCount, panelMaxRows } = computeLineageLayout({
    rows: stdout?.rows ?? 24,
    panelOpen: lineagePanel.isOpen,
    entryCount: lineageEntries.length,
  });

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
    // Help overlay owns all input while open — the HelpOverlay component's own
    // handler closes it on `?`/Esc, so here we simply swallow everything else.
    if (showHelp) return;

    // Confirm prompt owns keystrokes when open.
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

    // Search input mode owns most keystrokes.
    if (searchOpen) {
      if (key.escape) {
        setSearchOpen(false);
        setSearchQuery('');
        setAutocompleteCandidates([]);
        return;
      }
      if (key.return) {
        // Enter with an empty query or zero matches clears everything —
        // otherwise the user would land in a dim-all state with no
        // obvious recovery besides Esc.
        if (!searchQuery || searchMatches.length === 0) {
          setSearchOpen(false);
          setSearchQuery('');
          setAutocompleteCandidates([]);
          return;
        }
        // Jump to nearest match, close input, preserve query.
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
        // L4: shell-style Tab autocomplete. Complete to the longest common
        // prefix of all prefix-matching component names; when >1 candidate,
        // surface a possibilities strip. Prefix semantics (NOT fuzzy) — the
        // fuzzy `[n]` match-cycle is a separate, preserved path. No-op with no
        // candidates (never crashes). Input stays open.
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

    // Cycles panel owns most keystrokes when open.
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

    // Lineage panel owns most keystrokes when open. Close-side (`[l]` / `[Esc]`)
    // delegated to the shared `useOverlayPanel` hook (T10). The step-specific
    // `[c]` cross-to-cycles switch runs BEFORE the shared handler so `c` is
    // captured as a hand-off rather than a toggle.
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

    // AI-rationale panel owns most keystrokes when open. Close-side (`[x]` /
    // `[Esc]`) delegated to the shared `useOverlayPanel` hook; ↑/↓/j/k move the
    // banner cursor and Enter jumps the main cursor to the flagged component.
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
      if (key.escape && reasonPanelOpen) {
        setReasonPanelOpen(false);
        return;
      }
      // T5: jump-filter takes Esc priority over search-query. If both are
      // active, first Esc clears the jump; a second Esc clears the query.
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
    if (input === 's') {
      setReasonPanelOpen((prev) => !prev);
      return;
    }
    if (input === 'l') {
      // From a side column, jump the main cursor to the highlighted row first
      // so the existing lineage-panel machinery (which reads focusedComponent
      // off the main cursor) targets the intended component.
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
    // L8 — category filter toggles. `[o]` cycles, `[w]` broken. Independent
    // toggles; multiple active filters union in `filterVisibleKeys`. Grouped
    // view hides non-matching rows; flat view dims them (existing behavior).
    if (input === 'o' || input === 'w') {
      const category: FilterCategory = input === 'o' ? 'cycles' : 'broken';
      setActiveFilters((prev) => {
        const next = new Set(prev);
        if (next.has(category)) next.delete(category);
        else next.add(category);
        return next;
      });
      return;
    }
    // T5 — jump-and-filter to the focused component + all transitive
    // ancestors. Grouped view only (buildVisibleRows ignores
    // `filterVisibleKeys` in flat view). Toggling `[i]` on the same target
    // clears it; targeting a different row replaces the filter.
    // Guard against Ctrl-I aliasing: Tab is Ctrl+I (\x09), which
    // `parseInput` surfaces as `input='i'` with `key.tab=true, key.ctrl=true`.
    // Without this guard every Tab would toggle the jump-filter.
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
    if (input === 'a' || input === ' ' || input === 'r') {
      const isReject = input === 'r';
      // Side columns only show accepted items — [a]/Space are no-ops there
      // (re-accepting is meaningless). [r] rejects the highlighted row via
      // requestReject (which fires the cascade confirm-prompt when the blast
      // radius warrants it).
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
      // Toggle Column-1 view between grouped and flat. Preserve cursor
      // on the same underlying component when possible; otherwise reset to 0.
      const currentKey = currentRowKey;
      const nextView: 'grouped' | 'flat' =
        columnOneView === 'grouped' ? 'flat' : 'grouped';
      const nextRows = buildVisibleRows({
        items: groupedItems,
        cycleParticipants,
        expandedGroups: new Set(),
        alwaysExpanded: true,
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
      // Toggle-all excludes cycle participants from the direct selection set,
      // but if any accepted non-cycle component's slot points at a cycle
      // member, the cycle unit MUST come with it — otherwise the manifest
      // has an accepted parent pointing at a non-accepted cycle target
      // (invariant violation). See cycle-cohesion note in
      // `analyze/scope-gate-cascade.ts`.
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
        // Flip back: non-cycle → rejected. Any cycle member that was
        // accepted-by-cohesion during the previous [A] press drops to
        // undecided (nothing accepted references them anymore).
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
      // Accept every non-cycle-participant that the AI did NOT flag as
      // rejected/failed. Same cycle-cohesion caveat as [A]: any accepted
      // ancestor whose slot targets a cycle member drags the cycle unit in.
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
    // T3: [n] cycles matches when search is closed with an active query.
    // Previously Tab cycled matches; Tab now falls through to column-focus
    // cycling (three-column) or is a no-op.
    if (input === 'n' && searchQuery && searchMatches.length > 0) {
      const cursorRow = visibleRows[safeCursor];
      const cursorName =
        cursorRow && cursorRow.itemIdx >= 0
          ? groupedItems[cursorRow.itemIdx]?.key
          : undefined;
      const curIdx = cursorName ? searchMatches.indexOf(cursorName) : -1;
      const nextName = searchMatches[(curIdx + 1) % searchMatches.length];
      if (nextName) jumpCursorTo(nextName);
      return;
    }
    if (key.tab) {
      if (columnPlan.layout !== 'three-column') return;
      const forward: FocusedColumn[] = ['main', 'added-components', 'added-groups'];
      const curIdx = forward.indexOf(focusedColumn);
      // useImmediateInput surfaces Shift-Tab (CSI Z, \x1b[Z) as key.shiftTab;
      // forward cycles main → added-components → added-groups, reverse walks
      // the same cycle backwards.
      const delta = key.shiftTab ? -1 : 1;
      setFocusedColumn(forward[(curIdx + delta + forward.length) % forward.length]);
      return;
    }
    // Enter in side columns jumps main cursor and returns focus to main.
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
  // L7 — goto-banner rows for the AI-rationale panel. One row per AI-flagged
  // component that carries a reason; the label pairs the name with the full
  // reason (the sidebar-slot box wraps long text), and `jumpTarget` drives the
  // main-cursor jump on Enter.
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

  const showRunningHeader =
    aiFilterStatus === 'running' && aiFilterProgress !== null && aiFilterProgress.total > 0;
  const showCancelledBanner = aiFilterStatus === 'cancelled';
  const showFailedBanner = aiFilterStatus === 'failed';
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

  // Clamp column cursors when their lists shrink under decisions changes.
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
      <Text color="green">✓ Extraction complete</Text>
      <Text dimColor>
        Found {totalComponents} component{totalComponents === 1 ? '' : 's'}. Pick which ones to import. Generation runs
        only on the included set.
      </Text>

      {showRunningHeader && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="cyan">
            [AI filtering ({aiFilterProgress!.done}/{aiFilterProgress!.total})…] <Text dimColor>[q] cancels</Text>
          </Text>
        </Box>
      )}
      {showCancelledBanner && (
        <Box marginTop={1}>
          <Text color="yellow">
            AI auto-filter cancelled
            {aiFilterProgress ? ` at ${aiFilterProgress.done}/${aiFilterProgress.total}` : ''}. Review remaining
            manually.
          </Text>
        </Box>
      )}
      {showFailedBanner && (
        <Box marginTop={1}>
          <Text color="yellow">
            AI auto-filter failed: {aiFilterError ?? 'unknown error'}. Continuing without AI suggestions.
          </Text>
        </Box>
      )}

      {hasAnyAi && (
        <Box>
          <Text dimColor>
            {`AI recommended exclusions (${aiExcludedCount})`}
            {aiRows.length > 0 && <Text color="cyan">{' — [x] review & jump'}</Text>}
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
          <Text color="yellow">
            nothing selected — press{' '}
            <Text color="cyan">[Y]</Text> to accept all non-flagged,{' '}
            <Text color="cyan">[A]</Text> to toggle all, or{' '}
            <Text color="cyan">[a]</Text> to accept the highlighted row
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
            expandedGroups={new Set()}
            onToggleExpanded={() => {}}
            width={sidebarWidth}
            focused={focusedColumn === 'main'}
            scrollOffset={scrollOffset}
            visibleCount={visibleCount}
            alwaysExpanded={true}
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
            />
            <Box width={2} flexShrink={0} />
            <AddedGroupsColumn
              width={columnPlan.groups}
              entries={addedGroups}
              cursor={safeAddedGroupsCursor}
              focused={focusedColumn === 'added-groups'}
              aiFlaggedByKey={aiFlaggedByKey}
            />
          </>
        )}
      </Box>

      {focusedComponent && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text color="cyan">{focusedComponent.name}</Text>
            <Text dimColor>{' — '}</Text>
            {isIncluded(focusedComponent.name) ? (
              <Text color="green">included</Text>
            ) : (
              <Text color="red">excluded</Text>
            )}
            {isAiFlagged(focusedComponent) && <Text color="yellow" bold>{' [×]'}</Text>}
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

      {reasonPanelOpen && focusedComponent && isAiFlagged(focusedComponent) && (
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
          <Text dimColor bold>{`AI rejection reason: ${focusedComponent.name}`}</Text>
          <Text>{focusedComponent.aiReason ?? '<no reason given>'}</Text>
          <Text dimColor>[s] close · [Esc] close</Text>
        </Box>
      )}

      {cyclesPanelOpen && (
        <Box flexDirection="column" borderStyle="single" borderColor="red" paddingX={1} marginTop={1}>
          <Text bold color="red">{`Cycles detected (${slotCycles.length}):`}</Text>
          <Text> </Text>
          {slotCycles.map((cycle, i) => {
            const isCursor = i === cyclesCursor;
            const parts: string[] = [];
            // Interleave component / slot / component / ... ending with
            // the repeated start component. cycle.edges[i] connects
            // path[i] → path[i+1]; slotName lives on path[i].
            for (let idx = 0; idx < cycle.edges.length; idx++) {
              parts.push(cycle.path[idx]);
              parts.push(`[${cycle.edges[idx].slotName}]`);
            }
            parts.push(cycle.path[cycle.path.length - 1]);
            const label = `Cycle ${i + 1}: ${parts.join(' → ')}`;
            return (
              <Text key={i}>
                {isCursor ? (
                  <Text color="cyan" bold>{'▶'}</Text>
                ) : (
                  <Text> </Text>
                )}
                <Text color="red" inverse={isCursor}>{' ' + label}</Text>
              </Text>
            );
          })}
          <Text dimColor>[↑/↓] move · [Enter] jump · [c/Esc] close</Text>
        </Box>
      )}

      {pendingRejectCascade && (
        <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1} marginTop={1}>
          <Text bold color="yellow">
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
            <Text color="cyan">{'▎'}</Text>
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
          <Text dimColor>{`/${searchQuery}  (${totalMatches}/${totalComponents} matches) · [Esc] clear · [n] next`}</Text>
        </Box>
      )}

      {/* L11 — one wrapping legend region. Each entry is a single atomic Text
          node (via legendEntry) so a key never wraps away from its label.
          Toggle/mode keys ([l] [i] [L] [o] [/] [w]) render inverse+yellow when
          active so the legend reflects current state. Distinct cycle labels:
          [c] "cycle list" (panel) vs [o] "only cycles" (filter). */}
      <Box gap={2} marginTop={1} flexWrap="wrap">
        {includedCount > 0 ? (
          <Text>
            <Text color="green">{includedCount}</Text>
            <Text dimColor>/{totalComponents} included</Text>
          </Text>
        ) : (
          <Text color="yellow">none included</Text>
        )}
        {legendEntry('[j/k]', 'move')}
        {legendEntry('[a/space]', 'accept')}
        {legendEntry('[r]', 'reject')}
        {legendEntry('[A]', 'toggle all')}
        {legendEntry('[Y]', 'accept non-flagged')}
        {legendEntry('[L]', 'flat', columnOneView === 'flat')}
        {legendEntry('[l]', 'lineage', lineagePanel.isOpen)}
        {legendEntry('[i]', 'focus lineage', jumpFilterTarget !== null)}
        {legendEntry('[w]', 'only broken', activeFilters.has('broken'))}
        {hasCycles && legendEntry('[o]', 'only cycles', activeFilters.has('cycles'))}
        {hasCycles && legendEntry('[c]', 'cycle list', cyclesPanelOpen)}
        {legendEntry('[/]', 'search', searchOpen || searchQuery.length > 0)}
        {legendEntry('[f]', 'continue')}
        {legendEntry('[?]', 'help')}
        {legendEntry('[q]', 'quit')}
        {columnPlan.layout === 'three-column' && legendEntry('[Tab/Shift-Tab]', 'switch column')}
        {columnPlan.layout === 'three-column' && legendEntry('[Enter]', 'jump to main')}
        {hasAnyAi && legendEntry('[s]', 'AI reason', reasonPanelOpen)}
        {hasAnyAi && legendEntry('[x]', 'AI exclusions', aiRationalePanel.isOpen)}
        {hasAnyAi && (
          <Text>
            <Text color="yellow" bold>[×]</Text> <Text dimColor>AI recommends excluding</Text>
          </Text>
        )}
      </Box>
    </Box>
  );
}

/**
 * Top counter strip. Always visible above the columns. Condenses labels to
 * short forms when the terminal is narrower than 60 columns.
 */
function CounterStrip(props: {
  counters: { accepted: number; rejected: number; undecided: number; groups: number; total: number };
  totalWidth: number;
}): React.ReactElement {
  const { counters, totalWidth } = props;
  const condensed = totalWidth < 60;
  const labelAcc = condensed ? 'Acc' : 'Accepted';
  const labelGrp = condensed ? 'Grp' : 'Groups';
  const labelRej = condensed ? 'Rej' : 'Rejected';
  const labelUnd = condensed ? 'Und' : 'Undecided';
  const sep = condensed ? ' | ' : '    ';
  return (
    <Box marginTop={1}>
      <Text>
        <Text dimColor>{labelAcc} </Text>
        <Text bold>{counters.accepted}</Text>
        <Text dimColor>{`/${counters.total}`}</Text>
        <Text dimColor>{sep}</Text>
        <Text dimColor>{labelGrp} </Text>
        <Text bold>{counters.groups}</Text>
        <Text dimColor>{sep}</Text>
        <Text dimColor>{labelRej} </Text>
        <Text bold>{counters.rejected}</Text>
        <Text dimColor>{sep}</Text>
        <Text dimColor>{labelUnd} </Text>
        <Text bold>{counters.undecided}</Text>
      </Text>
    </Box>
  );
}

function ColumnHeader(props: { title: string; width: number; focused: boolean }): React.ReactElement {
  const { title, width, focused } = props;
  const sep = '─'.repeat(Math.max(0, width - 2));
  return (
    <Box flexDirection="column">
      <Text bold color={focused ? 'white' : 'cyan'} inverse={focused}>
        {title}
      </Text>
      <Text dimColor>{sep}</Text>
    </Box>
  );
}

/**
 * Compute style tokens for a side-column row. Pure so unit tests can pin the
 * cursor-override behavior directly (ink-testing-library strips ANSI, so
 * asserting colors on rendered frames isn't feasible).
 *
 * Rules:
 *   - Cursor row (selected + focused): bold white on inverse — overrides
 *     green/red/dim regardless of row kind. `▶` glyph is drawn separately.
 *   - Selected row when NOT focused: underline, retain non-cursor coloring —
 *     signals "cursor is here but column doesn't own input" (mirrors
 *     GroupedSidebar's `underline={isSelected && !focused}` pattern).
 *   - Non-cursor cycle rows: name renders red; the `⚠` glyph is drawn
 *     separately in bold yellow. Group `(N deps)` suffix stays red (spec:
 *     "keep red for the whole label" on cycle rows).
 *   - Non-cursor accepted rows: name renders green (matches the `[✓]` glyph
 *     in Column 1). Group `(N deps)` suffix renders dim cyan.
 */
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
      nameColor: 'white',
      nameBold: true,
      nameInverse: true,
      nameUnderline: false,
      suffixColor: 'white',
      suffixDim: false,
      suffixInverse: true,
      suffixUnderline: false,
    };
  }
  const underline = isSelected && !focused;
  if (isCycle) {
    return {
      nameColor: 'red',
      nameBold: false,
      nameInverse: false,
      nameUnderline: underline,
      suffixColor: 'red',
      suffixDim: false,
      suffixInverse: false,
      suffixUnderline: underline,
    };
  }
  return {
    nameColor: 'green',
    nameBold: false,
    nameInverse: false,
    nameUnderline: underline,
    suffixColor: 'cyan',
    suffixDim: true,
    suffixInverse: false,
    suffixUnderline: underline,
  };
}

function AddedComponentsColumn(props: {
  width: number;
  entries: AddedComponentEntry[];
  cursor: number;
  focused: boolean;
  aiFlaggedByKey?: Map<string, boolean>;
}): React.ReactElement {
  const { width, entries, cursor, focused, aiFlaggedByKey } = props;
  // Only reserve the 4-char AI-badge column when at least one row in this
  // column is actually flagged. Keeps the existing badge-free layout stable
  // for graphs with no AI activity (and preserves existing test snapshots).
  const reserveAiBadge = entries.some((e) => aiFlaggedByKey?.get(e.name) === true);
  const firstNonCycleIdx = entries.findIndex((e) => !e.isCycle);
  return (
    <Box
      flexDirection="column"
      width={width}
      flexShrink={0}
      borderStyle="single"
      borderColor={focused ? 'white' : undefined}
    >
      <ColumnHeader title="Added components" width={width} focused={focused} />
      {entries.length === 0 ? (
        <Text dimColor>(none)</Text>
      ) : (
        entries.map((entry, i) => {
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
                  <Text color="cyan" bold>
                    {'▶'}
                  </Text>
                ) : (
                  <Text> </Text>
                )}
                {reserveAiBadge && (
                  aiFlagged ? (
                    <Text color="yellow" bold>
                      {' [×]'}
                    </Text>
                  ) : (
                    <Text>{'    '}</Text>
                  )
                )}
                {entry.isCycle && (
                  <Text
                    color={isCursor ? 'white' : 'yellow'}
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
        })
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
}): React.ReactElement {
  const { width, entries, cursor, focused, aiFlaggedByKey } = props;
  // Match AddedComponentsColumn: reserve the AI badge column only when at
  // least one composite root in this column is AI-flagged.
  const reserveAiBadge = entries.some((g) => aiFlaggedByKey?.get(g.name) === true);
  const firstNonCycleIdx = entries.findIndex((e) => !e.isCycle);
  return (
    <Box
      flexDirection="column"
      width={width}
      flexShrink={0}
      borderStyle="single"
      borderColor={focused ? 'white' : undefined}
    >
      <ColumnHeader title="Added groups" width={width} focused={focused} />
      {entries.length === 0 ? (
        <Text dimColor>(none)</Text>
      ) : (
        entries.map((g, i) => {
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
                  <Text color="cyan" bold>
                    {'▶'}
                  </Text>
                ) : (
                  <Text> </Text>
                )}
                {reserveAiBadge && (
                  aiFlagged ? (
                    <Text color="yellow" bold>
                      {' [×]'}
                    </Text>
                  ) : (
                    <Text>{'    '}</Text>
                  )
                )}
                {g.isCycle && (
                  <Text
                    color={isCursor ? 'white' : 'yellow'}
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
        })
      )}
    </Box>
  );
}

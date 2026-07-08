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
import { findSlotCycles } from '../../../analyze/cycle-detection.js';
import {
  buildAncestorTree,
  renderAncestorTree,
} from '../../../analyze/lineage.js';
import {
  computeAcceptCascade,
  computeRejectCascade,
} from '../../../analyze/selection-cascade.js';
import { fuzzyMatches } from '../../../analyze/fuzzy-search.js';
import {
  buildAddedComponentsList,
  buildAddedGroupsList,
  computeColumnWidths,
  computeCounters,
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

const VISIBLE_COUNT = 20;
const REASON_DISPLAY_MAX = 60;
const AI_BANNER_MAX = 5;

function truncateReason(reason: string | null | undefined): string {
  if (reason === null || reason === undefined || reason === '') return '<no reason given>';
  if (reason.length <= REASON_DISPLAY_MAX) return reason;
  return reason.slice(0, REASON_DISPLAY_MAX - 1).trimEnd() + '…';
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

type LineageEntry =
  | { kind: 'section'; label: string }
  | { kind: 'ancestor'; label: string; jumpTarget: string }
  | { kind: 'descendant'; label: string; jumpTarget: string }
  | { kind: 'empty'; label: string };

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
  const [lineagePanelOpen, setLineagePanelOpen] = useState(false);
  const [lineageCursor, setLineageCursor] = useState(0);
  const [pendingRejectCascade, setPendingRejectCascade] =
    useState<{ target: string; ancestors: string[]; descendants: string[] } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const baselineState = (name: string): Decision => {
    const c = components.find((x) => x.name === name);
    if (!c) return 'accepted';
    return isAiFlagged(c) ? 'rejected' : 'accepted';
  };

  const getState = (name: string): Decision => {
    const v = userDecisions.get(name);
    return v ?? baselineState(name);
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
    () =>
      components.map((c) => ({
        name: c.name,
        slots: (c.slots ?? []).map((s) => ({ name: s.name, allowedComponents: s.allowedComponents })),
      })),
    [components],
  );

  const cycleParticipants = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    try {
      const cycles = findSlotCycles(graph);
      for (const c of cycles) for (const n of c.path) set.add(n);
    } catch {
      // Defensive.
    }
    return set;
  }, [graph]);

  const closures = useMemo(() => computeAllClosures(graph), [graph]);

  const visibleRows = useMemo(
    () =>
      buildVisibleRows({
        items: groupedItems,
        cycleParticipants,
        expandedGroups: new Set(),
        alwaysExpanded: true,
        showFlatTier: true,
      }),
    [groupedItems, cycleParticipants],
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
    const rejectCascade = computeRejectCascade(target, graph);
    const acceptCascade = computeAcceptCascade(target, graph);
    const entries: Array<[string, Decision]> = [];
    // Target + ancestors → rejected.
    for (const n of rejectCascade) entries.push([n, 'rejected']);
    // Descendants (accept-cascade minus target) → undecided.
    for (const n of acceptCascade) {
      if (n !== target) entries.push([n, 'undecided']);
    }
    applyDecisions(entries);
  };
  const applyAccept = (target: string): void => {
    const cascade = computeAcceptCascade(target, graph);
    applyDecisions([...cascade].map((n) => [n, 'accepted'] as [string, Decision]));
  };

  const requestToggle = (name: string): void => {
    if (isIncluded(name)) {
      // Reject path — may require confirm.
      const rejectCascade = computeRejectCascade(name, graph);
      const acceptCascade = computeAcceptCascade(name, graph);
      const ancestors = [...rejectCascade].filter((n) => n !== name).sort();
      const descendants = [...acceptCascade].filter((n) => n !== name).sort();
      // Blast radius = ancestors flipping to rejected + descendants flipping
      // to undecided. Prompt when total ≥ 2.
      if (ancestors.length + descendants.length >= 2) {
        setPendingRejectCascade({ target: name, ancestors, descendants });
        return;
      }
      applyReject(name);
    } else {
      applyAccept(name);
    }
  };

  const handleToggleFocused = (): void => {
    const row = visibleRows[safeCursor];
    if (!row) return;
    switch (row.kind) {
      case 'standalone':
      case 'empty':
      case 'group-root':
      case 'group-child':
      case 'flat': {
        const key = row.itemIdx >= 0 ? groupedItems[row.itemIdx]?.key : undefined;
        if (key) requestToggle(key);
        return;
      }
      case 'cycle':
      case 'flat-header':
      default:
        return;
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

  // Lineage panel entries for the focused component.
  const lineageEntries = useMemo<LineageEntry[]>(() => {
    if (!focusedComponent) return [];
    const name = focusedComponent.name;
    const tree = buildAncestorTree(name, graph);
    const closure = closures.get(name);
    const entries: LineageEntry[] = [];
    entries.push({ kind: 'section', label: 'Ancestors:' });
    if (tree.parents.length === 0) {
      entries.push({ kind: 'empty', label: '  (no ancestors)' });
    } else {
      const lines = renderAncestorTree(tree);
      for (const line of lines) {
        entries.push({
          kind: 'ancestor',
          label: '  ' + line.text,
          jumpTarget: line.jumpTarget ?? name,
        });
      }
    }
    entries.push({ kind: 'section', label: 'Descendants:' });
    if (!closure || closure.nodes.length <= 1) {
      entries.push({ kind: 'empty', label: '  (none)' });
    } else {
      for (const node of closure.nodes) {
        if (node.name === name) continue;
        entries.push({
          kind: 'descendant',
          label: '  ' + '  '.repeat(Math.max(0, node.depth - 1)) + node.name,
          jumpTarget: node.name,
        });
      }
    }
    return entries;
  }, [focusedComponent, graph, closures]);

  const lineageJumpables = useMemo(
    () =>
      lineageEntries
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => e.kind === 'ancestor' || e.kind === 'descendant'),
    [lineageEntries],
  );

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
      else if (idx >= prev + VISIBLE_COUNT) nextScroll = idx - VISIBLE_COUNT + 1;
      return { cursor: idx, scrollOffset: nextScroll };
    });
  };

  useImmediateInput((input, key) => {
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
        return;
      }
      if (key.return) {
        // Enter with an empty query or zero matches clears everything —
        // otherwise the user would land in a dim-all state with no
        // obvious recovery besides Esc.
        if (!searchQuery || searchMatches.length === 0) {
          setSearchOpen(false);
          setSearchQuery('');
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
      if (key.backspace) {
        setSearchQuery((q) => q.slice(0, -1));
        return;
      }
      if (input && input.length === 1 && input >= ' ' && input !== '\r' && input !== '\n') {
        setSearchQuery((q) => q + input);
        return;
      }
      return;
    }

    // Lineage panel owns most keystrokes when open.
    if (lineagePanelOpen) {
      if (key.escape || input === 'l') {
        setLineagePanelOpen(false);
        return;
      }
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
        if (target && (target.e.kind === 'ancestor' || target.e.kind === 'descendant')) {
          jumpCursorTo(target.e.jumpTarget);
        }
        setLineagePanelOpen(false);
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
      if (key.escape && searchQuery) {
        setSearchQuery('');
        return;
      }
      onQuit();
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
        const name = addedComponents[safeAddedComponentsCursor];
        if (name) jumpCursorTo(name);
      } else if (focusedColumn === 'added-groups') {
        const g = addedGroups[safeAddedGroupsCursor];
        if (g) jumpCursorTo(g.name);
      }
      setLineagePanelOpen(true);
      setLineageCursor(0);
      return;
    }
    if (input === '/') {
      setSearchOpen(true);
      return;
    }
    if (input === 'a' || input === ' ' || input === 'r') {
      handleToggleFocused();
      return;
    }
    if (input === 'A') {
      const selectable = components.filter((c) => !cycleParticipants.has(c.name)).map((c) => c.name);
      const anyNotAccepted = selectable.some((n) => getState(n) !== 'accepted');
      const target: Decision = anyNotAccepted ? 'accepted' : 'rejected';
      applyDecisions(selectable.map((n) => [n, target] as [string, Decision]));
      return;
    }
    if (key.tab) {
      // Search-match cycling has priority when a query is active — matches
      // existing behavior. Column-focus cycling only kicks in in three-column
      // layout when the user is not actively searching.
      if (searchQuery && searchMatches.length > 0) {
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
      if (columnPlan.layout !== 'three-column') return;
      const forward: FocusedColumn[] = ['main', 'added-components', 'added-groups'];
      const curIdx = forward.indexOf(focusedColumn);
      const delta = 1; // shift-tab is not distinguishable via useImmediateInput; forward-only.
      setFocusedColumn(forward[(curIdx + delta + forward.length) % forward.length]);
      return;
    }
    // Enter in side columns jumps main cursor and returns focus to main.
    if (key.return) {
      if (focusedColumn === 'added-components') {
        const name = addedComponents[safeAddedComponentsCursor];
        if (name) jumpCursorTo(name);
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
        const nextScroll = next >= prev + VISIBLE_COUNT ? next - VISIBLE_COUNT + 1 : prev;
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

  const selectedItemIdx =
    currentRow && currentRow.itemIdx >= 0 ? currentRow.itemIdx : -1;

  const showRunningHeader =
    aiFilterStatus === 'running' && aiFilterProgress !== null && aiFilterProgress.total > 0;
  const showCancelledBanner = aiFilterStatus === 'cancelled';
  const showFailedBanner = aiFilterStatus === 'failed';
  const allRejected =
    aiFilterStatus === 'complete' && components.length > 0 && components.every((c) => !isIncluded(c.name));

  const totalComponents = components.length;
  const totalMatches = searchQuery ? searchMatches.length : 0;

  const addedComponents = useMemo(
    () => buildAddedComponentsList(components, selectionStateByKey),
    [components, selectionStateByKey],
  );
  const addedGroups = useMemo(
    () => buildAddedGroupsList(graph, selectionStateByKey),
    [graph, selectionStateByKey],
  );
  const counters = useMemo(
    () => computeCounters(components, graph, selectionStateByKey),
    [components, graph, selectionStateByKey],
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
        <Box flexDirection="column">
          <Text dimColor>{`AI recommended exclusions (${aiExcludedCount}):`}</Text>
          {aiExcludedWithReasons.slice(0, AI_BANNER_MAX).map((c) => (
            <Text key={c.name} dimColor>
              {'  '}
              {c.name} — {truncateReason(c.aiReason)}
            </Text>
          ))}
          {aiExcludedWithReasons.length > AI_BANNER_MAX && (
            <Text dimColor>{`  …and ${aiExcludedWithReasons.length - AI_BANNER_MAX} more`}</Text>
          )}
        </Box>
      )}

      {!allRejected && (
        <CounterStrip counters={counters} totalWidth={totalWidth} />
      )}

      {allRejected ? (
        <Box marginTop={1}>
          <Text color="yellow">AI excluded all components — press [a] to override or [q] to quit</Text>
        </Box>
      ) : (
        <Box flexDirection="row">
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
            visibleCount={VISIBLE_COUNT}
            alwaysExpanded={true}
            showFlatTier={true}
            selectionStateByKey={selectionStateByKey}
            aiFlaggedByKey={aiFlaggedByKey}
            dimPredicate={dimPredicate}
            visibleRows={visibleRows}
          />
          {columnPlan.layout === 'three-column' && (
            <>
              <Box width={2} flexShrink={0} />
              <AddedComponentsColumn
                width={columnPlan.added}
                names={addedComponents}
                cursor={safeAddedComponentsCursor}
                focused={focusedColumn === 'added-components'}
              />
              <Box width={2} flexShrink={0} />
              <AddedGroupsColumn
                width={columnPlan.groups}
                groups={addedGroups}
                cursor={safeAddedGroupsCursor}
                focused={focusedColumn === 'added-groups'}
              />
            </>
          )}
        </Box>
      )}

      {focusedComponent && !allRejected && (
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
              <Text dimColor>{truncateReason(focusedComponent.aiReason)}</Text>
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

      {lineagePanelOpen && focusedComponent && (
        <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} marginTop={1}>
          <Text bold>{`Lineage: ${focusedComponent.name}`}</Text>
          {lineageEntries.map((e, i) => {
            const jumpableIdx = lineageJumpables.findIndex((j) => j.i === i);
            const isCursor = jumpableIdx === lineageCursor && jumpableIdx >= 0;
            if (e.kind === 'section') {
              return (
                <Text key={i} bold>
                  {'  '}
                  {e.label}
                </Text>
              );
            }
            if (e.kind === 'empty') {
              return (
                <Text key={i}>
                  <Text> </Text>
                  <Text dimColor>{' ' + e.label}</Text>
                </Text>
              );
            }
            return (
              <Text key={i}>
                {isCursor ? (
                  <Text color="cyan" bold>
                    {'▶'}
                  </Text>
                ) : (
                  <Text> </Text>
                )}
                <Text inverse={isCursor}>{' ' + e.label}</Text>
              </Text>
            );
          })}
          <Text dimColor>[↑/↓] move · [Enter] jump · [l/Esc] close</Text>
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
        <Box marginTop={1}>
          <Text>
            {`/${searchQuery}`}
            <Text color="cyan">{'▎'}</Text>
            {searchQuery && (
              <Text dimColor>{`  (${totalMatches}/${totalComponents} matches)`}</Text>
            )}
          </Text>
        </Box>
      )}
      {!searchOpen && searchQuery && (
        <Box marginTop={1}>
          <Text dimColor>{`/${searchQuery}  (${totalMatches}/${totalComponents} matches) · [Esc] clear · [Tab] next`}</Text>
        </Box>
      )}

      <Box gap={3} marginTop={1}>
        {includedCount > 0 ? (
          <Text>
            <Text color="green">{includedCount}</Text>
            <Text dimColor>/{totalComponents} included</Text>
          </Text>
        ) : (
          <Text color="yellow">none included</Text>
        )}
        <Text>
          <Text color="cyan">[j/k]</Text> <Text dimColor>move</Text>
        </Text>
        <Text>
          <Text color="cyan">[a/space]</Text> <Text dimColor>toggle</Text>
        </Text>
        <Text>
          <Text color="cyan">[l]</Text> <Text dimColor>lineage</Text>
        </Text>
        <Text>
          <Text color="cyan">[/]</Text> <Text dimColor>search</Text>
        </Text>
        <Text>
          <Text color="cyan">[A]</Text> <Text dimColor>toggle all</Text>
        </Text>
        <Text>
          <Text color="cyan">[f]</Text> <Text dimColor>continue</Text>
        </Text>
        <Text>
          <Text color="cyan">[q]</Text> <Text dimColor>quit</Text>
        </Text>
        {columnPlan.layout === 'three-column' && (
          <Text>
            <Text color="cyan">[Tab]</Text> <Text dimColor>switch column</Text>
          </Text>
        )}
        {hasAnyAi && (
          <Text>
            <Text color="cyan">[s]</Text> <Text dimColor>AI reason</Text>
          </Text>
        )}
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
      <Text bold color={focused ? 'white' : undefined} inverse={focused}>
        {title}
      </Text>
      <Text dimColor>{sep}</Text>
    </Box>
  );
}

function AddedComponentsColumn(props: {
  width: number;
  names: string[];
  cursor: number;
  focused: boolean;
}): React.ReactElement {
  const { width, names, cursor, focused } = props;
  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <ColumnHeader title="Added components" width={width} focused={focused} />
      {names.length === 0 ? (
        <Text dimColor>(none)</Text>
      ) : (
        names.map((name, i) => {
          const isCursor = focused && i === cursor;
          return (
            <Box key={name}>
              {isCursor ? (
                <Text color="cyan" bold>
                  {'▶'}
                </Text>
              ) : (
                <Text> </Text>
              )}
              <Text
                color={isCursor ? 'white' : undefined}
                bold={isCursor}
                inverse={isCursor}
                wrap="truncate"
              >
                {' ' + name}
              </Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}

function AddedGroupsColumn(props: {
  width: number;
  groups: Array<{ name: string; depCount: number }>;
  cursor: number;
  focused: boolean;
}): React.ReactElement {
  const { width, groups, cursor, focused } = props;
  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <ColumnHeader title="Added groups" width={width} focused={focused} />
      {groups.length === 0 ? (
        <Text dimColor>(none)</Text>
      ) : (
        groups.map((g, i) => {
          const isCursor = focused && i === cursor;
          const label = `${g.name} (${g.depCount} dep${g.depCount === 1 ? '' : 's'})`;
          return (
            <Box key={g.name}>
              {isCursor ? (
                <Text color="cyan" bold>
                  {'▶'}
                </Text>
              ) : (
                <Text> </Text>
              )}
              <Text
                color={isCursor ? 'white' : undefined}
                bold={isCursor}
                inverse={isCursor}
                wrap="truncate"
              >
                {' ' + label}
              </Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}

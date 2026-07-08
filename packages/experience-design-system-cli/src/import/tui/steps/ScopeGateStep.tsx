import { Box, Text } from 'ink';
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
const SIDEBAR_WIDTH = 36;
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
  const [userExcluded, setUserExcluded] = useState<Set<string>>(new Set());
  const [userUnExcluded, setUserUnExcluded] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [reasonPanelOpen, setReasonPanelOpen] = useState(false);
  const [lineagePanelOpen, setLineagePanelOpen] = useState(false);
  const [lineageCursor, setLineageCursor] = useState(0);
  const [pendingRejectCascade, setPendingRejectCascade] =
    useState<{ target: string; ancestors: string[] } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const isIncluded = (name: string): boolean => {
    if (userExcluded.has(name)) return false;
    if (userUnExcluded.has(name)) return true;
    const c = components.find((x) => x.name === name);
    if (!c) return true;
    return !isAiFlagged(c);
  };

  const flipToExcluded = (names: Iterable<string>): void => {
    setUserExcluded((prev) => {
      const next = new Set(prev);
      for (const n of names) next.add(n);
      return next;
    });
    setUserUnExcluded((prev) => {
      const next = new Set(prev);
      for (const n of names) next.delete(n);
      return next;
    });
  };

  const flipToIncluded = (names: Iterable<string>): void => {
    setUserUnExcluded((prev) => {
      const next = new Set(prev);
      for (const n of names) next.add(n);
      return next;
    });
    setUserExcluded((prev) => {
      const next = new Set(prev);
      for (const n of names) next.delete(n);
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
      map.set(c.name, isIncluded(c.name) ? 'accepted' : 'rejected');
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [components, userExcluded, userUnExcluded]);

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
    const cascade = computeRejectCascade(target, graph);
    flipToExcluded(cascade);
  };
  const applyAccept = (target: string): void => {
    const cascade = computeAcceptCascade(target, graph);
    flipToIncluded(cascade);
  };

  const requestToggle = (name: string): void => {
    if (isIncluded(name)) {
      // Reject path — may require confirm.
      const cascade = computeRejectCascade(name, graph);
      const ancestors = [...cascade].filter((n) => n !== name).sort();
      // Blast radius = number of ancestors that will flip to rejected.
      // Only count those currently included (already-excluded ancestors don't
      // add operator-visible surprise, but keep this simple: use ancestor count).
      if (ancestors.length >= 2) {
        setPendingRejectCascade({ target: name, ancestors });
        return;
      }
      flipToExcluded(cascade);
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
      case 'group-more':
      case 'flat-header':
      default:
        return;
    }
  };

  const partition = (): { accepted: string[]; rejected: string[] } => {
    const accepted: string[] = [];
    const rejected: string[] = [];
    for (const c of components) {
      if (isIncluded(c.name)) accepted.push(c.name);
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
    setCursor(idx);
    setScrollOffset((prev) => {
      if (idx < prev) return idx;
      if (idx >= prev + VISIBLE_COUNT) return idx - VISIBLE_COUNT + 1;
      return prev;
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
      const anyExcluded = selectable.some((n) => !isIncluded(n));
      if (anyExcluded) flipToIncluded(selectable);
      else flipToExcluded(selectable);
      return;
    }
    if (key.tab) {
      // Cycle through search matches only.
      if (searchQuery && searchMatches.length > 0) {
        const cursorRow = visibleRows[safeCursor];
        const cursorName =
          cursorRow && cursorRow.itemIdx >= 0
            ? groupedItems[cursorRow.itemIdx]?.key
            : undefined;
        const curIdx = cursorName ? searchMatches.indexOf(cursorName) : -1;
        const nextName = searchMatches[(curIdx + 1) % searchMatches.length];
        if (nextName) jumpCursorTo(nextName);
      }
      return;
    }
    if (key.upArrow || input === 'k') {
      if (total === 0) return;
      setCursor((c) => {
        const next = c <= 0 ? 0 : c - 1;
        setScrollOffset((prev) => Math.min(prev, next));
        return next;
      });
      return;
    }
    if (key.downArrow || input === 'j') {
      if (total === 0) return;
      setCursor((c) => {
        const next = c >= total - 1 ? total - 1 : c + 1;
        setScrollOffset((prev) => (next >= prev + VISIBLE_COUNT ? next - VISIBLE_COUNT + 1 : prev));
        return next;
      });
      return;
    }
  });

  const includedCount = useMemo(
    () => components.filter((c) => isIncluded(c.name)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [components, userExcluded, userUnExcluded],
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

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
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

      {allRejected ? (
        <Box marginTop={1}>
          <Text color="yellow">AI excluded all components — press [a] to override or [q] to quit</Text>
        </Box>
      ) : (
        <GroupedSidebar
          items={groupedItems}
          cycleParticipants={cycleParticipants}
          selectedIdx={selectedItemIdx}
          onSelect={() => {}}
          expandedGroups={new Set()}
          onToggleExpanded={() => {}}
          width={SIDEBAR_WIDTH}
          focused={true}
          scrollOffset={scrollOffset}
          visibleCount={VISIBLE_COUNT}
          alwaysExpanded={true}
          showFlatTier={true}
          selectionStateByKey={selectionStateByKey}
          aiFlaggedByKey={aiFlaggedByKey}
          dimPredicate={dimPredicate}
        />
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
            {isAiFlagged(focusedComponent) && <Text color="cyan">{' *'}</Text>}
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
                  {e.label}
                </Text>
              );
            }
            if (e.kind === 'empty') {
              return (
                <Text key={i} dimColor>
                  {e.label}
                </Text>
              );
            }
            return (
              <Text key={i} inverse={isCursor}>
                {e.label}
              </Text>
            );
          })}
          <Text dimColor>[↑/↓] move · [Enter] jump · [l/Esc] close</Text>
        </Box>
      )}

      {pendingRejectCascade && (
        <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1} marginTop={1}>
          <Text bold color="yellow">
            Reject {pendingRejectCascade.target}?
          </Text>
          <Text dimColor>
            This will also reject {pendingRejectCascade.ancestors.length} ancestor
            {pendingRejectCascade.ancestors.length === 1 ? '' : 's'} that slot it:
          </Text>
          {pendingRejectCascade.ancestors.map((a) => (
            <Text key={a}>{`  ${a}`}</Text>
          ))}
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
        {hasAnyAi && (
          <Text>
            <Text color="cyan">[s]</Text> <Text dimColor>AI reason</Text>
          </Text>
        )}
        {hasAnyAi && (
          <Text>
            <Text color="cyan">*</Text> <Text dimColor>originally excluded by AI</Text>
          </Text>
        )}
      </Box>
    </Box>
  );
}

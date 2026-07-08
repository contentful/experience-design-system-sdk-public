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

export type ScopeComponent = {
  name: string;
  componentId: string;
  aiDecision?: 'accepted' | 'rejected' | 'failed' | null;
  aiReason?: string | null;
  /**
   * Composite-components grouping: extraction-time slot metadata for this
   * component. When present on every scope component, ScopeGateStep renders
   * through GroupedSidebar so composite closures (root + deps) are visible
   * at selection time — matching the same tiering used in GenerateReviewStep.
   * When omitted (older callers, tests without slot data), every component
   * falls into the standalone tier and Space toggles just that row.
   */
  slots?: Array<{ name: string; allowedComponents: string[] }>;
};

export type ScopeGateStepProps = {
  components: ScopeComponent[];
  onConfirm: (decisions: { accepted: string[]; rejected: string[] }) => void;
  onQuit: () => void;
  // Feature 3: auto-filter overlay state. Optional so existing callers (and
  // tests) without auto-filter still work unchanged.
  aiFilterStatus?: 'idle' | 'running' | 'complete' | 'cancelled' | 'failed';
  aiFilterProgress?: { done: number; total: number } | null;
  aiFilterError?: string | null;
  onCancelAutoFilter?: () => void;
};

const VISIBLE_COUNT = 20;
const SIDEBAR_WIDTH = 36;
const REASON_DISPLAY_MAX = 60;

function truncateReason(reason: string | null | undefined): string {
  if (reason === null || reason === undefined || reason === '') return '<no reason given>';
  if (reason.length <= REASON_DISPLAY_MAX) return reason;
  return reason.slice(0, REASON_DISPLAY_MAX - 1).trimEnd() + '…';
}

function isAiFlagged(row: ScopeComponent): boolean {
  // INTEG-4318: `failed` means the LLM omitted a decision for this component
  // (e.g. batch under-emit). Treat as rejected for the default-inclusion
  // computation so silent inclusion regressions never resurface.
  return row.aiDecision === 'rejected' || row.aiDecision === 'failed';
}

/**
 * Build a synthetic CDFComponentEntry from a scope-gate component so the
 * shared `GroupedSidebar` (which was designed to consume the review-stage
 * entry shape) can render our data. The stub `$properties` prevents the
 * empty-tier fallback in GroupedSidebar — extraction-stage components with
 * zero slots would otherwise be surfaced as yellow `(empty)` rows.
 */
function toSidebarEntry(c: ScopeComponent): CDFComponentEntry {
  const $slots: NonNullable<CDFComponentEntry['$slots']> = {};
  if (c.slots) {
    for (const s of c.slots) {
      $slots[s.name] = { $allowedComponents: s.allowedComponents };
    }
  }
  const entry: CDFComponentEntry = {
    $type: 'component',
    // The scope-gate sidebar only needs $slots for closure detection; but
    // GroupedSidebar's empty-tier heuristic also inspects $properties. Give
    // every row a placeholder so nothing lands in the yellow empty tier.
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
  // Inclusion delta over the AI default. Operator toggles are always sticky
  // even when AI streaming updates arrive later (Pilot-2026-06-25 R2 invariant
  // preserved from the flat-sidebar rewrite).
  const [userExcluded, setUserExcluded] = useState<Set<string>>(new Set());
  const [userUnExcluded, setUserUnExcluded] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  // Reason side panel — kept for narrow-terminal / screen-reader overflow.
  const [reasonPanelOpen, setReasonPanelOpen] = useState(false);

  const isIncluded = (name: string): boolean => {
    if (userExcluded.has(name)) return false;
    if (userUnExcluded.has(name)) return true;
    const c = components.find((x) => x.name === name);
    if (!c) return true;
    return !isAiFlagged(c);
  };

  const flipToExcluded = (names: string[]): void => {
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

  const flipToIncluded = (names: string[]): void => {
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

  // Build the GroupedSidebar item list. Sorted so the underlying `items`
  // array's `selectedIdx` isn't strictly needed by our keyboard model — we
  // drive selection off the visible-rows list directly.
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

  // Cycle-participant set drives GroupedSidebar's cycle tier.
  const cycleParticipants = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    try {
      const cycles = findSlotCycles(graph);
      for (const c of cycles) for (const n of c.path) set.add(n);
    } catch {
      // Defensive — cycle detection must never crash the scope-gate UI.
    }
    return set;
  }, [graph]);

  const closures = useMemo(() => computeAllClosures(graph), [graph]);

  // Flat list of visible rows GroupedSidebar renders, in the exact order it
  // will render them. We drive cursor / space-toggle semantics against this
  // list so our behavior stays in lockstep with the visual layout — including
  // when a group collapses or expands.
  const visibleRows = useMemo(
    () => buildVisibleRows({ items: groupedItems, cycleParticipants, expandedGroups }),
    [groupedItems, cycleParticipants, expandedGroups],
  );

  const total = visibleRows.length;

  // Clamp cursor if the row set shrinks (e.g. after collapse).
  const safeCursor = Math.min(cursor, Math.max(0, total - 1));

  const currentRow = visibleRows[safeCursor];
  const currentRowKey = currentRow && currentRow.itemIdx >= 0 ? groupedItems[currentRow.itemIdx]?.key : undefined;
  const focusedComponent = currentRowKey ? components.find((c) => c.name === currentRowKey) : undefined;

  // Toggle the closure anchored at `rootName`. If every node is currently
  // included → exclude them all; otherwise → include them all. This matches
  // the "selecting a root auto-selects its full closure" spec while still
  // giving the operator a way to drop the whole subtree.
  const toggleClosure = (rootName: string): void => {
    const closure = closures.get(rootName);
    const names = closure ? closure.nodes.map((n) => n.name) : [rootName];
    const allIncluded = names.every((n) => isIncluded(n));
    if (allIncluded) flipToExcluded(names);
    else flipToIncluded(names);
  };

  const toggleSingle = (name: string): void => {
    if (isIncluded(name)) flipToExcluded([name]);
    else flipToIncluded([name]);
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

  const handleToggleFocused = (): void => {
    const row = visibleRows[safeCursor];
    if (!row) return;
    // Standalones + empty rows toggle a single component. Group-root rows
    // toggle the whole closure. Group-child + cycle + synthetic rows are
    // no-ops per spec (child selection follows its root; cycle rows are
    // advisory-only; `+N more` has no component).
    switch (row.kind) {
      case 'standalone':
      case 'empty': {
        const key = row.itemIdx >= 0 ? groupedItems[row.itemIdx]?.key : undefined;
        if (key) toggleSingle(key);
        return;
      }
      case 'group-root': {
        if (row.rootName) toggleClosure(row.rootName);
        return;
      }
      case 'group-child':
      case 'cycle':
      case 'group-more':
      default:
        return;
    }
  };

  const handleToggleExpand = (): void => {
    const row = visibleRows[safeCursor];
    if (!row || row.kind !== 'group-root' || !row.rootName) return;
    const name = row.rootName;
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  useImmediateInput((input, key) => {
    if (input === 'q' || key.escape) {
      if (aiFilterStatus === 'running' && onCancelAutoFilter) {
        onCancelAutoFilter();
        return;
      }
      if (key.escape && reasonPanelOpen) {
        setReasonPanelOpen(false);
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
    if (key.return) {
      handleToggleExpand();
      return;
    }
    // `a`, space, and `r` all toggle. `r` kept as muscle-memory alias.
    if (input === 'a' || input === ' ' || input === 'r') {
      handleToggleFocused();
      return;
    }
    if (input === 'A') {
      // Toggle-all across every selectable component (skipping cycle rows so
      // we don't silently ship components that can't be pushed anyway). If
      // any selectable is excluded, include everything; otherwise exclude
      // everything.
      const selectable = components.filter((c) => !cycleParticipants.has(c.name)).map((c) => c.name);
      const anyExcluded = selectable.some((n) => !isIncluded(n));
      if (anyExcluded) flipToIncluded(selectable);
      else flipToExcluded(selectable);
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
    [components, userExcluded, userUnExcluded],
  );
  const hasAnyAi = components.some(isAiFlagged);
  const aiExcludedCount = components.filter(isAiFlagged).length;

  // GroupedSidebar's `selectedIdx` is an index into `items` (not visibleRows),
  // so translate the cursor via the current row's `itemIdx`. Synthetic rows
  // (`+N more`) don't map back to an item — leave `selectedIdx` on the last
  // real selection so nothing else in the sidebar loses its inverse-color.
  const selectedItemIdx = currentRow && currentRow.itemIdx >= 0 ? currentRow.itemIdx : -1;

  const showRunningHeader =
    aiFilterStatus === 'running' && aiFilterProgress !== null && aiFilterProgress.total > 0;
  const showCancelledBanner = aiFilterStatus === 'cancelled';
  const showFailedBanner = aiFilterStatus === 'failed';
  const allRejected = aiFilterStatus === 'complete' && components.length > 0 && components.every((c) => !isIncluded(c.name));

  const totalComponents = components.length;

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
        <Text dimColor>{`AI recommended exclusions: ${aiExcludedCount}`}</Text>
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
          expandedGroups={expandedGroups}
          onToggleExpanded={(rootName) => {
            setExpandedGroups((prev) => {
              const next = new Set(prev);
              if (next.has(rootName)) next.delete(rootName);
              else next.add(rootName);
              return next;
            });
          }}
          width={SIDEBAR_WIDTH}
          focused={true}
          scrollOffset={scrollOffset}
          visibleCount={VISIBLE_COUNT}
        />
      )}

      {/* Focused-row detail: inclusion state + AI reason (if any). The
          in-row `[✓]`/`[✗]` glyphs and `*` marker from the flat sidebar are
          replaced by GroupedSidebar's tier rendering; we surface the same
          signal here for the focused row instead. */}
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
          <Text color="cyan">[Enter]</Text> <Text dimColor>expand/collapse</Text>
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

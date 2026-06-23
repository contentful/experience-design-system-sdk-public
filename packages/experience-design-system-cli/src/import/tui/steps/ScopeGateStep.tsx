import { Box, Text } from 'ink';
import React, { useMemo, useState } from 'react';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';

export type ScopeComponent = {
  name: string;
  componentId: string;
  aiDecision?: 'accepted' | 'rejected' | null;
  aiReason?: string | null;
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

const VISIBLE_COUNT = 10;
const EXCLUDED_VISIBLE_CAP = 8;
const REASON_DISPLAY_MAX = 60;

function truncateReason(reason: string | null | undefined): string {
  if (reason === null || reason === undefined || reason === '') return '<no reason given>';
  if (reason.length <= REASON_DISPLAY_MAX) return reason;
  return reason.slice(0, REASON_DISPLAY_MAX - 1).trimEnd() + '…';
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
  // Initial AI-excluded set is derived from the prop. The user can later
  // move components in/out of this set via `r` (exclude) and `a` (un-exclude
  // when cursor is on an AI-excluded row). Tracking this as state — rather
  // than re-deriving from the prop — is what makes cross-section moves
  // possible (pilot-2026-06-23 fix).
  const initialExcluded = useMemo(
    () => new Set(components.filter((c) => c.aiDecision === 'rejected').map((c) => c.name)),
    [components],
  );
  const [excludedNames, setExcludedNames] = useState<Set<string>>(initialExcluded);
  // mainList preserves prop order minus currently-excluded names. excludedList
  // preserves prop order of currently-excluded names. Both update reactively
  // via excludedNames.
  const { mainList, excludedList } = useMemo(() => {
    const main: ScopeComponent[] = [];
    const excluded: ScopeComponent[] = [];
    for (const c of components) {
      if (excludedNames.has(c.name)) excluded.push(c);
      else main.push(c);
    }
    return { mainList: main, excludedList: excluded };
  }, [components, excludedNames]);

  const [included, setIncluded] = useState<Set<string>>(
    () => new Set(components.filter((c) => c.aiDecision !== 'rejected').map((c) => c.name)),
  );
  // Cursor indexes into the unified order [...mainList, ...excludedList].
  // Initial cursor on first non-excluded row (mainList[0]) — mainList comes
  // first in the unified order, so index 0 is correct unless mainList is
  // empty (all-rejected fallthrough banner handles that case).
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  // Feature 3 Task 6: collapse the AI-excluded section. Default expanded so
  // operators see what was filtered on first render.
  const [excludedCollapsed, setExcludedCollapsed] = useState(false);
  // Pilot-2026-06-23: `s` opens a side panel showing the full reject_reason
  // (untruncated) for the AI-excluded row under the cursor.
  const [reasonPanelOpen, setReasonPanelOpen] = useState(false);

  // Unified flat list cursor walks. Excluded section contributes only when
  // expanded — collapsing it must NOT let j/k walk into hidden rows.
  const flatList: ScopeComponent[] = excludedCollapsed ? mainList : [...mainList, ...excludedList];
  const cursorOnExcluded = (idx: number): boolean =>
    !excludedCollapsed && idx >= mainList.length && idx < mainList.length + excludedList.length;

  const partition = (): { accepted: string[]; rejected: string[] } => {
    const accepted: string[] = [];
    const rejected: string[] = [];
    for (const c of mainList) {
      if (included.has(c.name)) accepted.push(c.name);
      else rejected.push(c.name);
    }
    // AI-excluded components ALSO contribute to the rejected list when the
    // operator confirms — they were never in `included`. This way the dual-
    // write (status + snapshot) covers them.
    for (const c of excludedList) {
      if (included.has(c.name)) accepted.push(c.name);
      else rejected.push(c.name);
    }
    return { accepted, rejected };
  };

  useImmediateInput((input, key) => {
    if (input === 'q' || key.escape) {
      // Feature 3: while auto-filter is running, q cancels the LLM run instead
      // of quitting the wizard. After completion (or if no auto-filter ran), q
      // falls back to the existing wizard-quit behavior.
      if (aiFilterStatus === 'running' && onCancelAutoFilter) {
        onCancelAutoFilter();
        return;
      }
      // Esc also closes the reason panel without quitting.
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
      // Toggle the full-reason panel. Only meaningful when the cursor is on
      // an AI-excluded row, but accepting the keystroke unconditionally keeps
      // the binding predictable — the panel renderer no-ops when there is no
      // reason to show.
      setReasonPanelOpen((prev) => !prev);
      return;
    }
    if (input === 'a') {
      // On an AI-excluded row: un-exclude (move back to main list, default
      // included). On a main row: toggle inclusion (existing behavior).
      const onExcluded = cursorOnExcluded(cursor);
      const target = flatList[cursor];
      if (!target) return;
      if (onExcluded) {
        setExcludedNames((prev) => {
          if (!prev.has(target.name)) return prev;
          const next = new Set(prev);
          next.delete(target.name);
          return next;
        });
        setIncluded((prev) => {
          if (prev.has(target.name)) return prev;
          const next = new Set(prev);
          next.add(target.name);
          return next;
        });
        return;
      }
      setIncluded((prev) => {
        const next = new Set(prev);
        if (next.has(target.name)) next.delete(target.name);
        else next.add(target.name);
        return next;
      });
      return;
    }
    if (input === 'A') {
      const allIncluded = mainList.every((c) => included.has(c.name));
      if (allIncluded) setIncluded(new Set());
      else setIncluded(new Set(mainList.map((c) => c.name)));
      return;
    }
    if (input === 'r') {
      // r on a main-list row excludes (moves to AI-excluded). On an AI-
      // excluded row r is a no-op — the row is already excluded.
      const onExcluded = cursorOnExcluded(cursor);
      const target = flatList[cursor];
      if (!target) return;
      if (onExcluded) return;
      setExcludedNames((prev) => {
        if (prev.has(target.name)) return prev;
        const next = new Set(prev);
        next.add(target.name);
        return next;
      });
      setIncluded((prev) => {
        if (!prev.has(target.name)) return prev;
        const next = new Set(prev);
        next.delete(target.name);
        return next;
      });
      return;
    }
    if (input === 'c') {
      // Toggle AI-excluded section collapse. No-op when nothing is excluded.
      if (excludedList.length === 0) return;
      setExcludedCollapsed((prev) => {
        const nextCollapsed = !prev;
        // If collapsing while cursor is in the excluded section, snap cursor
        // back to the last main-list row so the user doesn't end up on an
        // invisible cursor.
        if (nextCollapsed) {
          setCursor((c) => (c >= mainList.length ? Math.max(0, mainList.length - 1) : c));
        }
        return nextCollapsed;
      });
      return;
    }
    if (key.upArrow || input === 'k') {
      const hasExcluded = !excludedCollapsed && excludedList.length > 0;
      const len = hasExcluded ? mainList.length + excludedList.length : mainList.length;
      if (len === 0) return;
      setCursor((c) => {
        // When the AI-excluded section is visible, k wraps cyclically so
        // that pressing k from the top main-list row enters the excluded
        // section (bottom). When it's collapsed (or absent), k clamps at 0.
        const next = c <= 0 ? (hasExcluded ? len - 1 : 0) : c - 1;
        setScrollOffset((prev) => Math.min(prev, next));
        return next;
      });
      return;
    }
    if (key.downArrow || input === 'j') {
      const hasExcluded = !excludedCollapsed && excludedList.length > 0;
      const len = hasExcluded ? mainList.length + excludedList.length : mainList.length;
      if (len === 0) return;
      setCursor((c) => {
        // When the excluded section is visible, j wraps cyclically: from
        // last excluded row back to first main-list row. (Stepping from
        // last main-list row into first excluded row falls out of normal
        // increment.) When collapsed (or absent), j clamps at len-1.
        const next = c >= len - 1 ? (hasExcluded ? 0 : len - 1) : c + 1;
        setScrollOffset((prev) => (next >= prev + VISIBLE_COUNT ? next - VISIBLE_COUNT + 1 : prev));
        return next;
      });
      return;
    }
  });

  const includedCount = included.size;
  const totalMain = mainList.length;
  const totalAll = components.length;

  const visibleEnd = Math.min(scrollOffset + VISIBLE_COUNT, totalMain);
  const visible = mainList.slice(scrollOffset, visibleEnd);
  const above = scrollOffset;
  const below = Math.max(0, totalMain - visibleEnd);

  // ── Banner / status helpers ───────────────────────────────────────────────
  const showRunningHeader =
    aiFilterStatus === 'running' && aiFilterProgress !== null && aiFilterProgress.total > 0;
  const showExcludedSection = excludedList.length > 0 && aiFilterStatus !== 'cancelled';
  const showCancelledBanner = aiFilterStatus === 'cancelled';
  const showFailedBanner = aiFilterStatus === 'failed';
  const allRejected = aiFilterStatus === 'complete' && totalMain === 0 && excludedList.length > 0;

  const visibleExcluded = excludedList.slice(0, EXCLUDED_VISIBLE_CAP);
  const moreExcluded = Math.max(0, excludedList.length - visibleExcluded.length);

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text color="green">✓ Extraction complete</Text>
      <Text dimColor>
        Found {totalAll} component{totalAll === 1 ? '' : 's'}. Pick which ones to import. Generation runs only on the
        included set.
      </Text>

      {/* Feature 3: auto-filter status banners */}
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
            {aiFilterProgress ? ` at ${aiFilterProgress.done}/${aiFilterProgress.total}` : ''}. Review remaining manually.
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

      {/* Feature 3: AI-excluded section */}
      {showExcludedSection && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="cyan">
            [AI excluded ({excludedList.length})] <Text dimColor>[c]{excludedCollapsed ? 'expand' : 'collapse'}</Text>
          </Text>
          {!excludedCollapsed && (
            <>
              {visibleExcluded.map((c, ei) => {
                // Cursor index in the unified flat list:
                // mainList.length + ei (only the first EXCLUDED_VISIBLE_CAP
                // are walkable on screen — the cursor logic itself uses the
                // full excludedList length, but visually we cap rendering).
                const isCursor = cursor === mainList.length + ei;
                const prefix = isCursor ? '›' : ' ';
                if (isCursor) {
                  return (
                    <Text key={c.componentId} color="cyan">
                      {prefix} [✓] {c.name} <Text dimColor>{truncateReason(c.aiReason)}</Text>
                    </Text>
                  );
                }
                return (
                  <Text key={c.componentId} dimColor>
                    {prefix} [✓] {c.name} <Text dimColor>{truncateReason(c.aiReason)}</Text>
                  </Text>
                );
              })}
              {moreExcluded > 0 && <Text dimColor>{'  '}↓ {moreExcluded} more</Text>}
            </>
          )}
        </Box>
      )}

      {/* Pilot-2026-06-23: full reject_reason side panel. Opens on `s` when
          cursor is on an AI-excluded row. Closes on `s` again or Esc. */}
      {reasonPanelOpen && cursorOnExcluded(cursor) && (() => {
        const target = flatList[cursor];
        if (!target) return null;
        return (
          <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
            <Text dimColor bold>{`AI rejection reason: ${target.name}`}</Text>
            <Text>{target.aiReason ?? '<no reason given>'}</Text>
            <Text dimColor>[s] close · [Esc] close</Text>
          </Box>
        );
      })()}

      {allRejected ? (
        <Box marginTop={1}>
          <Text color="yellow">AI excluded all components — press [a] to override or [q] to quit</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {above > 0 && <Text dimColor>↑ {above} above</Text>}
          {visible.map((c, vi) => {
            const i = vi + scrollOffset;
            const isCursor = i === cursor;
            const isIn = included.has(c.name);
            const marker = isIn ? '[✓]' : '[ ]';
            const prefix = isCursor ? '›' : ' ';
            if (isCursor) {
              return (
                <Text key={c.componentId} color="cyan">
                  {prefix} {marker} {c.name}
                </Text>
              );
            }
            if (!isIn) {
              return (
                <Text key={c.componentId} dimColor>
                  {prefix} {marker} {c.name}
                </Text>
              );
            }
            return (
              <Text key={c.componentId}>
                {prefix} <Text color="green">{marker}</Text> {c.name}
              </Text>
            );
          })}
          {below > 0 && <Text dimColor>↓ {below} below</Text>}
        </Box>
      )}

      <Box gap={3} marginTop={1}>
        {includedCount > 0 ? (
          <Text>
            <Text color="green">{includedCount}</Text>
            <Text dimColor>
              /{totalMain} included
            </Text>
          </Text>
        ) : (
          <Text color="yellow">none included</Text>
        )}
        <Text>
          <Text color="cyan">[j/k]</Text> <Text dimColor>move</Text>
        </Text>
        <Text>
          <Text color="cyan">[a]</Text> <Text dimColor>toggle</Text>
        </Text>
        <Text>
          <Text color="cyan">[A]</Text> <Text dimColor>toggle all</Text>
        </Text>
        <Text>
          <Text color="cyan">[r]</Text> <Text dimColor>reject</Text>
        </Text>
        <Text>
          <Text color="cyan">[f]</Text> <Text dimColor>continue</Text>
        </Text>
        <Text>
          <Text color="cyan">[q]</Text> <Text dimColor>quit</Text>
        </Text>
      </Box>
    </Box>
  );
}

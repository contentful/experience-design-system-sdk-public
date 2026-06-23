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
}: ScopeGateStepProps): React.ReactElement {
  // Partition into AI-rejected (sidebar above) and main list. Excluded list is
  // computed once per `components` prop change; the operator's later moves
  // (`a` / `r` in Task 6) will go through `included` set state.
  const { mainList, excludedList } = useMemo(() => {
    const main: ScopeComponent[] = [];
    const excluded: ScopeComponent[] = [];
    for (const c of components) {
      if (c.aiDecision === 'rejected') excluded.push(c);
      else main.push(c);
    }
    return { mainList: main, excludedList: excluded };
  }, [components]);

  const [included, setIncluded] = useState<Set<string>>(
    () => new Set(mainList.map((c) => c.name)),
  );
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  // Feature 3 Task 6: collapse the AI-excluded section. Default expanded so
  // operators see what was filtered on first render.
  const [excludedCollapsed, setExcludedCollapsed] = useState(false);

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
      onQuit();
      return;
    }
    if (input === 'f' || input === 'F') {
      onConfirm(partition());
      return;
    }
    if (input === 'a') {
      const name = mainList[cursor]?.name;
      if (!name) return;
      setIncluded((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
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
      const name = mainList[cursor]?.name;
      if (!name) return;
      setIncluded((prev) => {
        if (!prev.has(name)) return prev;
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
      return;
    }
    if (input === 'c') {
      // Toggle AI-excluded section collapse. No-op when nothing is excluded.
      if (excludedList.length === 0) return;
      setExcludedCollapsed((prev) => !prev);
      return;
    }
    if (key.upArrow || input === 'k') {
      setCursor((c) => {
        const next = Math.max(0, c - 1);
        setScrollOffset((prev) => Math.min(prev, next));
        return next;
      });
      return;
    }
    if (key.downArrow || input === 'j') {
      setCursor((c) => {
        const next = Math.min(Math.max(0, mainList.length - 1), c + 1);
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
              {visibleExcluded.map((c) => (
                <Text key={c.componentId} dimColor>
                  {'  '}[✓] {c.name} <Text dimColor>{truncateReason(c.aiReason)}</Text>
                </Text>
              ))}
              {moreExcluded > 0 && <Text dimColor>{'  '}↓ {moreExcluded} more</Text>}
            </>
          )}
        </Box>
      )}

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

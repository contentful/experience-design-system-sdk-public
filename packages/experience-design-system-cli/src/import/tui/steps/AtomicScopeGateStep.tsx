import { Box, Text, useStdout } from 'ink';
import React, { useMemo, useState } from 'react';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { AutoFilterBanner } from '../components/AutoFilterBanner.js';
import { CounterStrip } from '../components/CounterStrip.js';
import { isAiFlagged } from '../ai-flag.js';
import type { ScopeComponent, ScopeGateStepProps } from './ScopeGateStep.js';

// Atomic-mode scope gate (spec T9). Recovered from the pre-composite `main`
// implementation: a flat included/excluded list with NO hierarchy affordances
// (no closures, cycles, cascade, lineage, grouped sidebar, or graph). Styling
// is ported to PALETTE and the shared AutoFilterBanner/CounterStrip so it reads
// as the same product as its composite sibling — "fewer panels, identical look."

const VISIBLE_COUNT = 10;
const REASON_DISPLAY_MAX = 60;
const AI_MARKER = '*';
const REASON_WRAP_INDENT = '      ';

function truncateReason(reason: string | null | undefined): string {
  if (reason === null || reason === undefined || reason === '') return '<no reason given>';
  if (reason.length <= REASON_DISPLAY_MAX) return reason;
  return reason.slice(0, REASON_DISPLAY_MAX - 1).trimEnd() + '…';
}

export function AtomicScopeGateStep({
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

  // Inverted "included" model, kept from `main` (deliberately NOT the
  // composite step's userDecisions Map — see spec T9 "what to NOT share").
  const [userExcluded, setUserExcluded] = useState<Set<string>>(new Set());
  const [userUnExcluded, setUserUnExcluded] = useState<Set<string>>(new Set());

  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [reasonPanelOpen, setReasonPanelOpen] = useState(false);

  const aiList: ScopeComponent[] = components.filter(isAiFlagged);
  const componentsList: ScopeComponent[] = components.filter((c) => !isAiFlagged(c));
  const flatList: ScopeComponent[] = [...aiList, ...componentsList];

  const isIncluded = (row: ScopeComponent): boolean => {
    if (userExcluded.has(row.name)) return false;
    if (userUnExcluded.has(row.name)) return true;
    // INTEG-4318: exclude on 'rejected' AND 'failed'.
    return row.aiDecision !== 'rejected' && row.aiDecision !== 'failed';
  };

  const partition = (): { accepted: string[]; rejected: string[] } => {
    const accepted: string[] = [];
    const rejected: string[] = [];
    for (const c of flatList) {
      if (isIncluded(c)) accepted.push(c.name);
      else rejected.push(c.name);
    }
    return { accepted, rejected };
  };

  const toggleFocused = (): void => {
    const target = flatList[cursor];
    if (!target) return;
    const currentlyIn = isIncluded(target);
    if (currentlyIn) {
      setUserExcluded((prev) => {
        if (prev.has(target.name)) return prev;
        const next = new Set(prev);
        next.add(target.name);
        return next;
      });
      setUserUnExcluded((prev) => {
        if (!prev.has(target.name)) return prev;
        const next = new Set(prev);
        next.delete(target.name);
        return next;
      });
    } else {
      setUserUnExcluded((prev) => {
        if (prev.has(target.name)) return prev;
        const next = new Set(prev);
        next.add(target.name);
        return next;
      });
      setUserExcluded((prev) => {
        if (!prev.has(target.name)) return prev;
        const next = new Set(prev);
        next.delete(target.name);
        return next;
      });
    }
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
    if (input === 'a' || input === ' ' || input === 'r') {
      toggleFocused();
      return;
    }
    if (input === 'A') {
      const compNames = componentsList.map((c) => c.name);
      const anyCompExcluded = componentsList.some((c) => !isIncluded(c));
      if (anyCompExcluded) {
        setUserUnExcluded((prev) => {
          const next = new Set(prev);
          for (const n of compNames) next.add(n);
          return next;
        });
        setUserExcluded((prev) => {
          const next = new Set(prev);
          for (const n of compNames) next.delete(n);
          return next;
        });
      } else {
        setUserExcluded((prev) => {
          const next = new Set(prev);
          for (const n of compNames) next.add(n);
          return next;
        });
        setUserUnExcluded((prev) => {
          const next = new Set(prev);
          for (const n of compNames) next.delete(n);
          return next;
        });
      }
      return;
    }
    if (key.upArrow || input === 'k') {
      const len = flatList.length;
      if (len === 0) return;
      setCursor((c) => {
        const next = c <= 0 ? 0 : c - 1;
        setScrollOffset((prev) => Math.min(prev, next));
        return next;
      });
      return;
    }
    if (key.downArrow || input === 'j') {
      const len = flatList.length;
      if (len === 0) return;
      setCursor((c) => {
        const next = c >= len - 1 ? len - 1 : c + 1;
        setScrollOffset((prev) => (next >= prev + VISIBLE_COUNT ? next - VISIBLE_COUNT + 1 : prev));
        return next;
      });
      return;
    }
  });

  const total = flatList.length;
  const includedCount = useMemo(
    () => flatList.filter((c) => isIncluded(c)).length,
    [components, userExcluded, userUnExcluded],
  );
  const hasAnyAi = flatList.some(isAiFlagged);

  const visibleEnd = Math.min(scrollOffset + VISIBLE_COUNT, total);
  const visible = flatList.slice(scrollOffset, visibleEnd);
  const above = scrollOffset;
  const below = Math.max(0, total - visibleEnd);

  const allRejected = aiFilterStatus === 'complete' && total > 0 && flatList.every((c) => !isIncluded(c));

  // Atomic has no groups; the counter strip shows binary included/excluded.
  const counters = {
    accepted: includedCount,
    rejected: total - includedCount,
    undecided: 0,
    groups: 0,
    total,
  };

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text color={PALETTE.success}>✓ Extraction complete</Text>
      <Text dimColor>
        Found {total} component{total === 1 ? '' : 's'}. Pick which ones to import. Generation runs only on the included
        set.
      </Text>

      <AutoFilterBanner status={aiFilterStatus} progress={aiFilterProgress} error={aiFilterError} />

      <CounterStrip counters={counters} totalWidth={totalWidth} />

      {reasonPanelOpen && flatList[cursor] !== undefined && isAiFlagged(flatList[cursor]!) && (
        <Box flexDirection="column" borderStyle="single" borderColor={PALETTE.border} paddingX={1} marginTop={1}>
          <Text dimColor bold>{`AI rejection reason: ${flatList[cursor]!.name}`}</Text>
          <Text>{flatList[cursor].aiReason ?? '<no reason given>'}</Text>
          <Text dimColor>[s] close · [Esc] close</Text>
        </Box>
      )}

      {allRejected ? (
        <Box marginTop={1}>
          <Text color={PALETTE.warning}>AI excluded all components — press [a] to override or [q] to quit</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {above > 0 && <Text dimColor>↑ {above} above</Text>}
          {visible.map((c, vi) => {
            const i = vi + scrollOffset;
            const isCursor = i === cursor;
            const included = isIncluded(c);
            const aiFlagged = isAiFlagged(c);
            const prefix = isCursor ? '›' : ' ';
            const stateGlyph = included ? '[✓]' : '[✗]';
            const stateColor = included ? PALETTE.success : PALETTE.error;
            const aiMarkerNode = aiFlagged ? <Text color={PALETTE.info}>{`${AI_MARKER} `}</Text> : null;
            const inlineReason = !isCursor && aiFlagged ? ` ${truncateReason(c.aiReason)}` : '';
            const showAiHeader = aiList.length > 0 && i === 0;
            const showComponentsHeader = componentsList.length > 0 && i === aiList.length;
            const header = showAiHeader ? (
              <Text key={`hdr-ai-${i}`} bold>{`AI recommended exclusions (${aiList.length})`}</Text>
            ) : showComponentsHeader ? (
              <Text key={`hdr-comp-${i}`} bold>{`Components (${componentsList.length})`}</Text>
            ) : null;
            if (isCursor) {
              const wrapReason = aiFlagged && c.aiReason !== null && c.aiReason !== undefined && c.aiReason.length > 0;
              return (
                <React.Fragment key={c.componentId}>
                  {header}
                  <Text>
                    <Text color={PALETTE.info}>{`${prefix} `}</Text>
                    {aiMarkerNode}
                    <Text color={stateColor}>{stateGlyph}</Text>
                    <Text color={PALETTE.info}>{` ${c.name}`}</Text>
                  </Text>
                  {wrapReason && <Text dimColor>{`${REASON_WRAP_INDENT}${c.aiReason}`}</Text>}
                </React.Fragment>
              );
            }
            return (
              <React.Fragment key={c.componentId}>
                {header}
                <Text>
                  <Text>{`${prefix} `}</Text>
                  {aiMarkerNode}
                  <Text color={stateColor}>{stateGlyph}</Text>
                  <Text color={stateColor}>{` ${c.name}`}</Text>
                  {inlineReason !== '' && <Text dimColor>{inlineReason}</Text>}
                </Text>
              </React.Fragment>
            );
          })}
          {below > 0 && <Text dimColor>↓ {below} below</Text>}
        </Box>
      )}

      <Box gap={3} marginTop={1}>
        {includedCount > 0 ? (
          <Text>
            <Text color={PALETTE.success}>{includedCount}</Text>
            <Text dimColor>/{total} included</Text>
          </Text>
        ) : (
          <Text color={PALETTE.warning}>none included</Text>
        )}
        <Text>
          <Text color={PALETTE.info}>[j/k]</Text> <Text dimColor>move</Text>
        </Text>
        <Text>
          <Text color={PALETTE.info}>[a/space]</Text> <Text dimColor>toggle</Text>
        </Text>
        <Text>
          <Text color={PALETTE.info}>[A]</Text> <Text dimColor>toggle all</Text>
        </Text>
        <Text>
          <Text color={PALETTE.info}>[f]</Text> <Text dimColor>continue</Text>
        </Text>
        <Text>
          <Text color={PALETTE.info}>[q]</Text> <Text dimColor>quit</Text>
        </Text>
        {hasAnyAi && (
          <Text>
            <Text color={PALETTE.info}>[s]</Text> <Text dimColor>AI reason</Text>
          </Text>
        )}
        {hasAnyAi && (
          <Text>
            <Text color={PALETTE.info}>*</Text> <Text dimColor>originally excluded by AI</Text>
          </Text>
        )}
      </Box>
    </Box>
  );
}

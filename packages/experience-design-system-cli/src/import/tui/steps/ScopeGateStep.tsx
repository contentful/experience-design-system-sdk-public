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
const REASON_DISPLAY_MAX = 60;
// Pilot-2026-06-25 R2: AI-flagged rows render a subtle cyan `*` glyph before
// the name (in place of the Round-1 `[AI]` text badge). The marker persists
// regardless of whether the operator later toggles the row INCLUDED — manual
// decision wins; the marker is informational only.
const AI_MARKER = '*';
// Indentation prefix for the wrapped reason on the focused AI row. Aligns
// the reason under the row label so the eye reads it as a continuation.
const REASON_WRAP_INDENT = '      ';

function truncateReason(reason: string | null | undefined): string {
  if (reason === null || reason === undefined || reason === '') return '<no reason given>';
  if (reason.length <= REASON_DISPLAY_MAX) return reason;
  return reason.slice(0, REASON_DISPLAY_MAX - 1).trimEnd() + '…';
}

function isAiFlagged(row: ScopeComponent): boolean {
  return row.aiDecision === 'rejected';
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
  // Pilot-2026-06-25: scope-gate UX overhaul — single unified list.
  //
  // Inverted mental model: we now track which rows are INCLUDED rather than
  // which are EXCLUDED. The underlying delta-on-prop pattern survives so
  // operator decisions stay sticky across streaming AI updates:
  //   - userExcluded: rows the operator explicitly toggled OFF
  //   - userUnExcluded: rows the operator explicitly toggled ON
  // Effective INCLUDED for a row:
  //   if userExcluded.has(name): false
  //   else if userUnExcluded.has(name): true
  //   else: row.aiDecision !== 'rejected'   // default: follow AI, default true if AI silent
  const [userExcluded, setUserExcluded] = useState<Set<string>>(new Set());
  const [userUnExcluded, setUserUnExcluded] = useState<Set<string>>(new Set());

  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  // Pilot-2026-06-23: `s` opens a side panel showing the full reject_reason
  // (untruncated) for an AI-flagged row under the cursor. With the focused-row
  // wrap landed, the panel is mostly redundant — kept for screen-reader /
  // overflow cases per spec.
  const [reasonPanelOpen, setReasonPanelOpen] = useState(false);

  // Pilot-2026-06-25 R2: two-section render. AI-flagged rows go to a top
  // section ("AI recommended exclusions"); the rest fall into "Components".
  // Within each section we preserve prop (extraction) order. Cursor walks
  // the unified flat list [...aiList, ...componentsList].
  const aiList: ScopeComponent[] = components.filter(isAiFlagged);
  const componentsList: ScopeComponent[] = components.filter((c) => !isAiFlagged(c));
  const flatList: ScopeComponent[] = [...aiList, ...componentsList];

  const isIncluded = (row: ScopeComponent): boolean => {
    // Pilot-2026-06-25 invariant: operator decisions are ALWAYS sticky over
    // streaming AI updates. If the operator explicitly toggled this row
    // (userExcluded or userUnExcluded), that wins regardless of any later
    // aiDecision the auto-filter writes via prop updates. The [AI] badge
    // still appears on the row — it's informational, not authoritative.
    if (userExcluded.has(row.name)) return false;
    if (userUnExcluded.has(row.name)) return true;
    return row.aiDecision !== 'rejected';
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
      // Flip to EXCLUDED.
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
      // Flip to INCLUDED.
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
      setReasonPanelOpen((prev) => !prev);
      return;
    }
    // `a`, space, and `r` are all aliases for "toggle focused row INCLUDED ↔ EXCLUDED".
    // `r` kept for muscle-memory; it no longer means "reject".
    if (input === 'a' || input === ' ' || input === 'r') {
      toggleFocused();
      return;
    }
    if (input === 'A') {
      // Pilot-2026-06-25 R2: toggle-all operates ONLY on the Components
      // section. The AI section's defaults stay put — operators rarely want
      // a mass-include of AI-flagged rows via one keystroke. Toggle behavior:
      // if any Components row is excluded, include them all; else exclude all.
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

  // ── Banner / status helpers ───────────────────────────────────────────────
  const showRunningHeader = aiFilterStatus === 'running' && aiFilterProgress !== null && aiFilterProgress.total > 0;
  const showCancelledBanner = aiFilterStatus === 'cancelled';
  const showFailedBanner = aiFilterStatus === 'failed';
  const allRejected = aiFilterStatus === 'complete' && total > 0 && flatList.every((c) => !isIncluded(c));

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text color="green">✓ Extraction complete</Text>
      <Text dimColor>
        Found {total} component{total === 1 ? '' : 's'}. Pick which ones to import. Generation runs only on the included
        set.
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

      {/* Pilot-2026-06-23: full reject_reason side panel. Opens on `s` when
          cursor is on an AI-flagged row. Closes on `s` again or Esc. */}
      {reasonPanelOpen && flatList[cursor]?.aiDecision === 'rejected' && (
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
          <Text dimColor bold>{`AI rejection reason: ${flatList[cursor].name}`}</Text>
          <Text>{flatList[cursor].aiReason ?? '<no reason given>'}</Text>
          <Text dimColor>[s] close · [Esc] close</Text>
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
            const included = isIncluded(c);
            const aiFlagged = isAiFlagged(c);
            const prefix = isCursor ? '›' : ' ';
            // R2: color-glyphs replace word labels. Green [✓] for included,
            // red [✗] for excluded. The component name follows the same
            // color UNLESS the row is the cursor row, in which case the
            // name flips to cyan (state glyph keeps its red/green).
            const stateGlyph = included ? '[✓]' : '[✗]';
            const stateColor: 'green' | 'red' = included ? 'green' : 'red';
            // R2: cyan `*` glyph replaces the verbose `[AI]` badge.
            const aiMarkerNode = aiFlagged ? <Text color="cyan">{`${AI_MARKER} `}</Text> : null;
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
                    <Text color="cyan">{`${prefix} `}</Text>
                    {aiMarkerNode}
                    <Text color={stateColor}>{stateGlyph}</Text>
                    <Text color="cyan">{` ${c.name}`}</Text>
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

      {/* Pilot-2026-06-25: bottom legend.
          - `[c]` is gone (no collapsible AI section to toggle).
          - `[r]` is gone from the legend (kept as a muscle-memory alias for
            `[a/space]` but not advertised).
          - `[s] AI reason` only shows when the list contains an AI-flagged
            row, since the side panel is a no-op otherwise. */}
      <Box gap={3} marginTop={1}>
        {includedCount > 0 ? (
          <Text>
            <Text color="green">{includedCount}</Text>
            <Text dimColor>/{total} included</Text>
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

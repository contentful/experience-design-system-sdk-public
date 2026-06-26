import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../analyze/select/tui/hooks/useImmediateInput.js';
import type { RunRecord } from './store.js';

export type RunPickerAction = 'push' | 'modify' | 'new';

export type RunPickerSelection = {
  /** null only when `action === 'new'`. */
  runId: string | null;
  action: RunPickerAction;
};

export type RunPickerProps = {
  runs: RunRecord[];
  /** Optional set of run ids that have been classified stale by the
   *  invalidation check. Rows in this set render with a dim "(stale)" tag. */
  staleRunIds?: ReadonlySet<string>;
  onSelect: (selection: RunPickerSelection) => void;
  onCancel: () => void;
};

const COLLAPSED_LIMIT = 3;
/**
 * The picker collapses to top 3 + Show all only when there are 5+ total.
 * Four or fewer runs render in full.
 */
const COLLAPSE_THRESHOLD = 5;

/**
 * Format the createdAt timestamp as `YYYY-MM-DD HH:MM` in the operator's
 * local timezone. We intentionally use local time (not UTC) because the
 * picker is for human recognition — operators expect to see times in the
 * same zone they were when the run happened.
 */
function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function runLine(run: RunRecord): string {
  const date = formatCreatedAt(run.createdAt);
  const pushedTag = run.pushedTo ? 'pushed' : 'not pushed';
  const count = `${run.componentCount} component${run.componentCount === 1 ? '' : 's'}`;
  return `${run.id} - ${date} - ${run.projectPath} (${count}, ${pushedTag})`;
}

// ── Sub-screen: Push / Modify / Cancel ─────────────────────────────────────

type ActionOption = 'push' | 'modify' | 'cancel';
const ACTION_OPTIONS: { key: ActionOption; label: string; description: string }[] = [
  { key: 'push', label: 'Push', description: "Push this run's recorded session to Contentful." },
  { key: 'modify', label: 'Modify', description: 'Re-open the wizard at final-review with this run pre-filled.' },
  { key: 'cancel', label: 'Cancel', description: 'Back to the run list.' },
];

function ActionScreen({
  runId,
  onChoose,
  onBack,
}: {
  runId: string;
  onChoose: (action: 'push' | 'modify') => void;
  onBack: () => void;
}): React.ReactElement {
  const [focusIdx, setFocusIdx] = useState(0);

  const fire = (opt: ActionOption): void => {
    if (opt === 'cancel') return onBack();
    onChoose(opt);
  };

  useImmediateInput((rawInput, key) => {
    if (key.upArrow || rawInput === 'k') {
      setFocusIdx((i) => (i - 1 + ACTION_OPTIONS.length) % ACTION_OPTIONS.length);
      return;
    }
    if (key.downArrow || rawInput === 'j') {
      setFocusIdx((i) => (i + 1) % ACTION_OPTIONS.length);
      return;
    }
    if (key.return) {
      fire(ACTION_OPTIONS[focusIdx]!.key);
      return;
    }
    if (key.escape || rawInput === 'q') {
      onBack();
      return;
    }
  });

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text bold>Push or modify?</Text>
      <Text dimColor>Run {runId}</Text>
      <Box flexDirection="column" marginTop={1}>
        {ACTION_OPTIONS.map((opt, i) => {
          const focused = i === focusIdx;
          return (
            <Box key={opt.key} gap={1}>
              <Text color={focused ? 'cyan' : undefined}>{focused ? '>' : ' '}</Text>
              <Text color={focused ? 'cyan' : undefined}>{opt.label}</Text>
              <Text dimColor>- {opt.description}</Text>
            </Box>
          );
        })}
      </Box>
      <Box gap={3} marginTop={1}>
        <Text dimColor>[j/k] Navigate</Text>
        <Text dimColor>[Enter] Select</Text>
        <Text dimColor>[Esc] Back</Text>
      </Box>
    </Box>
  );
}

// ── Main picker ────────────────────────────────────────────────────────────

type Row =
  | { kind: 'run'; run: RunRecord }
  | { kind: 'show-all' }
  | { kind: 'new' };

function buildRows(runs: RunRecord[], expanded: boolean): Row[] {
  const showAll = expanded || runs.length < COLLAPSE_THRESHOLD;
  const visible = showAll ? runs : runs.slice(0, COLLAPSED_LIMIT);
  const rows: Row[] = visible.map((run) => ({ kind: 'run', run }) as Row);
  if (!showAll) rows.push({ kind: 'show-all' });
  rows.push({ kind: 'new' });
  return rows;
}

export function RunPicker({ runs, staleRunIds, onSelect, onCancel }: RunPickerProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  // When non-null, render the Push/Modify/Cancel sub-screen for this run.
  const [actionRunId, setActionRunId] = useState<string | null>(null);

  const rows = buildRows(runs, expanded);
  // Clamp focus if the row count shrinks (e.g. after expansion changes layout).
  const clampedFocus = Math.min(focusIdx, rows.length - 1);

  const selectRow = (row: Row): void => {
    if (row.kind === 'show-all') {
      setExpanded(true);
      // Keep cursor on the first newly-revealed run for continuity.
      setFocusIdx(COLLAPSED_LIMIT);
      return;
    }
    if (row.kind === 'new') {
      onSelect({ runId: null, action: 'new' });
      return;
    }
    setActionRunId(row.run.id);
  };

  useImmediateInput((rawInput, key) => {
    if (actionRunId !== null) {
      // Sub-screen owns input while it's active. (ActionScreen also installs
      // its own useImmediateInput; only one is mounted at a time so there's
      // no double-handle.)
      return;
    }
    if (key.upArrow || rawInput === 'k') {
      setFocusIdx((i) => (i - 1 + rows.length) % rows.length);
      return;
    }
    if (key.downArrow || rawInput === 'j') {
      setFocusIdx((i) => (i + 1) % rows.length);
      return;
    }
    if (rawInput === 'n') {
      onSelect({ runId: null, action: 'new' });
      return;
    }
    if (rawInput === 'q' || key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      const row = rows[clampedFocus];
      if (row) selectRow(row);
      return;
    }
  });

  if (actionRunId !== null) {
    return (
      <ActionScreen
        runId={actionRunId}
        onChoose={(action) => onSelect({ runId: actionRunId, action })}
        onBack={() => setActionRunId(null)}
      />
    );
  }

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text bold>Found {runs.length} prior run{runs.length === 1 ? '' : 's'}. Continue from one?</Text>
      <Box flexDirection="column" marginTop={1}>
        {rows.map((row, i) => {
          const focused = i === clampedFocus;
          const color = focused ? 'cyan' : undefined;
          const cursor = focused ? '>' : ' ';
          if (row.kind === 'run') {
            const isStale = staleRunIds?.has(row.run.id) ?? false;
            return (
              <Box key={`run-${row.run.id}`} gap={1}>
                <Text color={color}>{cursor}</Text>
                <Text color={color}>{runLine(row.run)}</Text>
                {isStale ? <Text dimColor> (stale)</Text> : null}
              </Box>
            );
          }
          if (row.kind === 'show-all') {
            return (
              <Box key="show-all" gap={1}>
                <Text color={color}>{cursor}</Text>
                <Text color={color}>Show all ({runs.length})</Text>
              </Box>
            );
          }
          return (
            <Box key="new" gap={1}>
              <Text color={color}>{cursor}</Text>
              <Text color={color}>[n] Start a new run</Text>
            </Box>
          );
        })}
      </Box>
      <Box gap={3} marginTop={1}>
        <Text dimColor>[j/k] Navigate</Text>
        <Text dimColor>[Enter] Select</Text>
        <Text dimColor>[n] New</Text>
        <Text dimColor>[q] Quit</Text>
      </Box>
    </Box>
  );
}

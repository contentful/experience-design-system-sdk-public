import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import type {
  BreakingChange,
  CDFComponentEntry,
  ComponentTypeSummary,
  DownstreamImpact,
  ServerPreviewResponse,
} from '@contentful/experience-design-system-types';
import {
  GroupedSidebar,
  buildVisibleRows,
  type VisibleRow,
} from '../../../analyze/select/tui/components/GroupedSidebar.js';
import { computeAllClosures, type ComponentGraphNode, type NodeStatus } from '../../../analyze/composite-closure.js';
import { buildComponentGraph } from '../../../analyze/slot-graph.js';
import { computeCycleView, type CycleView } from '../../../analyze/cycle-view.js';
import { computeRenderStatuses, pickDrillTarget, type RenderStatus } from '../../../analyze/issue-inheritance.js';
import { JsonPanel } from '../../../analyze/select/tui/components/JsonPanel.js';
import { FieldEditor } from '../../../analyze/select/tui/components/FieldEditor.js';
import { StatusBar } from '../../../analyze/select/tui/components/StatusBar.js';
import { FinalizeDialog } from '../../../analyze/select/tui/components/FinalizeDialog.js';
import { QuitDialog } from '../../../analyze/select/tui/components/QuitDialog.js';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';
import {
  openPipelineDb,
  loadCDFComponents,
  storeCDFComponents,
  loadComponentReviewMetadata,
  loadComponentRationale,
  loadSlotCycles,
  storeSlotCycles,
  type ComponentReviewMetadata,
  type ComponentRationale,
  type StoredSlotCycle,
} from '../../../session/db.js';
import { formatCyclePathSegments, findSlotCycles, suggestCycleBreakEdge } from '../../../analyze/cycle-detection.js';
import { followCycleScroll } from '../cycle-panel-scroll.js';
import { RationalePanel, type RationaleRow } from '../../../analyze/select/tui/components/RationalePanel.js';
import { ComponentRationalePanel } from '../../../analyze/select/tui/components/ComponentRationalePanel.js';
import type { FieldEditorMetadata } from '../../../analyze/select/tui/components/FieldEditor.js';
import type { PreviewAnnotation, ReviewComponentStatus } from '../../../analyze/select/types.js';
import { applyPreviewAnnotations } from '../../../analyze/select/preview-annotations.js';
import { useLivePreview } from '../useLivePreview.js';
import { computeNextScrollOffset } from '../../../analyze/select/tui/hooks/scroll-offset.js';
import { fuzzyMatches } from '../../../analyze/fuzzy-search.js';
import {
  computeDirectNeighborhood,
  findAllAncestors as findAllAncestorsInclusive,
} from '../../../analyze/search-neighborhood.js';
import { computeSidebarWidth } from '../sidebar-width.js';
import { computeAcceptCascade, computeRejectCascade } from '../../../analyze/selection-cascade.js';
import { findAllAncestors } from '../../../analyze/lineage.js';
import { useLineage } from '../hooks/useLineage.js';
import { useOverlayPanel } from '../hooks/useOverlayPanel.js';
import { LineagePanel } from '../../../analyze/select/tui/components/LineagePanel.js';
import { GotoBanner } from '../../../analyze/select/tui/components/GotoBanner.js';
import { computeSidebarBudget, FALLBACK_ROWS } from '../lineage-layout.js';
import { HelpOverlay, type HelpSection } from '../../../analyze/select/tui/components/HelpOverlay.js';
import { legendEntry } from '../components/LegendEntry.js';
import { computeAutoRejectDecision } from './auto-reject-decision.js';
import {
  enumerateCycleBreaks,
  shouldBreakOverlayGoFullScreen,
  type BreakEdge,
} from './enumerate-cycle-breaks.js';
import { createHistoryStack, type HistoryStack, type HistorySnapshot } from '../history.js';
import { computeAutocomplete } from '../autocomplete.js';
import { resolveGroupRoot } from '../group-collapse.js';
import {
  buildFlatDimPredicate,
  computeFilterKeys,
  intersectFilterKeys,
  type FilterCategory,
} from '../step-filters.js';

type CdfReviewEntry = {
  key: string;
  entry: CDFComponentEntry;
  status: ReviewComponentStatus;
};

type GenerateReviewStepProps = {
  extractSessionId: string;
  onFinalize: (accepted: number, rejected: number, unresolved: number) => void;
  onQuit: () => void;
  /**
   * Feature 2 (live preview after every save). When `true` (default), the
   * wizard re-runs `previewImport` after each successful FieldEditor Ctrl+S
   * (debounced 500ms) and refreshes the sidebar's previewAnnotation badges.
   * Operator opts out via `experiences import --no-live-preview`.
   */
  livePreview?: boolean;
  // Creds + tokens path threaded from the wizard so the live-preview hook
  // can call previewImport without re-prompting. Missing creds → silent
  // no-op inside the hook.
  spaceId?: string;
  environmentId?: string;
  cmaToken?: string;
  host?: string;
  tokensPath?: string;
  /**
   * INTEG-4411 refined: initial value for the inline `finalizeError` banner.
   * The wizard sets this when it routes back to `final-review` after the
   * preview API returned an empty diff (pure no-op push). Cleared on the
   * next `a` / `A` keystroke.
   */
  initialFinalizeError?: string | null;
};

/**
 * Sort components for the final-review sidebar so the underlying data array
 * matches the visual order. Empty components (zero classified $properties)
 * surface at the top via the warning-tier path in Sidebar.tsx; we mirror that
 * here so `selectedIdx` indexes into the same order the user sees. Without
 * this, j/k navigation lands on different rows than the visually-selected
 * one (INTEG-4259).
 *
 * Within each tier (empty / non-empty) we tie-break alphabetically by `key`.
 */
export function sortComponentsForSidebar<T extends { key: string; entry: CDFComponentEntry }>(
  components: T[],
  cycleParticipants?: Set<string>,
): T[] {
  const isEmpty = (entry: CDFComponentEntry): boolean =>
    Object.keys(entry.$properties ?? {}).length === 0 && Object.keys(entry.$slots ?? {}).length === 0;
  // Tier order: cycle members first (they block push — surface loudest),
  // then empty (soft warning), then everything else. Ties broken alpha.
  const tier = (c: T): number => {
    if (cycleParticipants?.has(c.key)) return 0;
    if (isEmpty(c.entry)) return 1;
    return 2;
  };
  return [...components].sort((a, b) => {
    const at = tier(a);
    const bt = tier(b);
    if (at !== bt) return at - bt;
    return a.key.localeCompare(b.key);
  });
}

const PANEL_HEIGHT = 22;

// L11 — help groups ordered by WHERE a key is used (navigation → selection →
// sidebar views/filters → panels → search → history → general). Sidebar-view
// keys (flat, lineage, focus-lineage, group expand/collapse, broken/cycles
// filters) cluster together because they all reshape the left column. The two
// cycle features carry DISTINCT labels: `[c]` = "Cycle list" (breakdown panel),
// `[o]` = "Only cycles" (sidebar filter). Component rationale is `[P]` (was
// `[I]`, which collided conceptually with lowercase `[i]` = focus-lineage).
// There is NO "Deleted" filter (removed per L11 item 8).
const HELP_SECTIONS: HelpSection[] = [
  {
    title: 'Navigation',
    entries: [
      { keys: 'j / k / ↑ / ↓', label: 'Move cursor' },
      { keys: 'Tab', label: 'Toggle sidebar/panel' },
      { keys: 'Enter', label: 'Drill to source' },
    ],
  },
  {
    title: 'Selection',
    entries: [
      { keys: 'a', label: 'Accept' },
      { keys: 'r', label: 'Reject' },
      { keys: 'A', label: 'Accept all' },
      { keys: 'F', label: 'Finalize' },
    ],
  },
  {
    title: 'Sidebar views',
    entries: [
      { keys: 'L', label: 'Flat view' },
      { keys: 'l', label: 'Lineage' },
      { keys: 'i', label: 'Focus lineage' },
      { keys: 'w', label: 'See breaking changes' },
      { keys: 'o', label: 'Only cycles' },
      { keys: 'space', label: 'Expand/collapse group' },
      { keys: 'E / C', label: 'Expand/collapse all' },
    ],
  },
  {
    title: 'Panels',
    entries: [
      { keys: 'c', label: 'Cycle list' },
      { keys: 'p', label: 'Prop rationale' },
      { keys: 'P', label: 'Component rationale' },
      { keys: 's', label: 'Source' },
      { keys: 'J', label: 'Toggle JSON' },
    ],
  },
  {
    // A7 — a slot-dependency cycle has TWO valid resolutions. State both so the
    // operator isn't left thinking rejection is the only path.
    title: 'Resolving cycles',
    entries: [
      { keys: '', label: 'Reject a cycle member (drops it from the push), or' },
      { keys: '', label: "break the cycle by removing a slot's" },
      { keys: '', label: '$allowedComponents edge (see [c] suggested fix).' },
      { keys: 'x', label: 'Break cycle (from [c]): delete a slot edge.' },
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
    title: 'History',
    entries: [
      { keys: 'Ctrl+Z', label: 'Undo' },
      { keys: 'Ctrl+Y', label: 'Redo' },
      { keys: 'Ctrl+R', label: 'Reload from save' },
    ],
  },
  {
    title: 'General',
    entries: [
      { keys: '?', label: 'Close help' },
      { keys: 'q', label: 'Quit' },
    ],
  },
];

/**
 * Task #37 — Given the current set of detected slot cycles and the component
 * graph, compute the union of cycle participants + every transitive ancestor
 * that slots any cycle participant. These are the components that must be
 * auto-rejected on mount so the review step never presents a cyclic manifest
 * as viable (cyclic manifests fail at push time via TopoSortCycleError).
 *
 * Pure by design so callers can unit-test the union without simulating the
 * mount effect. Empty `slotCycles` yields an empty set.
 */
export function computeCycleAutoRejectTargets(
  slotCycles: Array<{ path: string[] }>,
  graph: ComponentGraphNode[],
): Set<string> {
  const targets = new Set<string>();
  const participants = new Set<string>();
  for (const cyc of slotCycles) for (const p of cyc.path) participants.add(p);
  for (const p of participants) {
    targets.add(p);
    for (const anc of findAllAncestors(p, graph)) targets.add(anc);
  }
  return targets;
}

export interface BreakingComponent {
  componentName: string;
  changes: BreakingChange[];
  impact?: DownstreamImpact;
}

export interface BreakingRow {
  label: string;
  componentName: string;
  focusTarget?: { kind: 'prop' | 'slot'; name: string };
}

/**
 * BD2 — flatten breaking components to one row per change. Each change is a
 * discriminated union member keyed by presence: `propertyId` → prop branch,
 * `slotId` → slot branch. Components with no enumerated changes contribute a
 * single component-level row (no focusTarget) so the jump degrades to
 * land-on-the-row. Exported as a pure function so the prop/slot branching is
 * pinned by unit tests independent of the Ink render tree.
 */
export function buildBreakingRows(breakingChanges: BreakingComponent[]): BreakingRow[] {
  const out: BreakingRow[] = [];
  for (const b of breakingChanges) {
    if (b.changes.length === 0) {
      out.push({ label: `${b.componentName} — breaking`, componentName: b.componentName });
      continue;
    }
    for (const change of b.changes) {
      if ('slotId' in change) {
        out.push({
          label: `${b.componentName} · ${change.slotId}: ${change.reason}`,
          componentName: b.componentName,
          focusTarget: { kind: 'slot', name: change.slotId },
        });
      } else {
        out.push({
          label: `${b.componentName} · ${change.propertyId}: ${change.reason}`,
          componentName: b.componentName,
          focusTarget: { kind: 'prop', name: change.propertyId },
        });
      }
    }
  }
  return out;
}

/**
 * L6 (lifecycle plan §5 L6 + §5.1 Q2) — pull the per-component breaking-change
 * detail out of a live-preview response. `applyPreviewAnnotations` only keeps
 * the bare kind `'breaking'`; the goto-banner needs the reasons + downstream
 * impact, so we read `response.components.changed` directly. Component name is
 * the changed entity's `current.name`.
 */
export function deriveBreakingChanges(response: ServerPreviewResponse): BreakingComponent[] {
  const out: BreakingComponent[] = [];
  for (const item of response.components.changed ?? []) {
    if (item.changeClassification?.classification !== 'breaking') continue;
    const componentName = item.current?.name;
    if (typeof componentName !== 'string') continue;
    out.push({
      componentName,
      changes: item.changeClassification.breakingChanges ?? [],
      impact: item.impact,
    });
  }
  return out;
}

export function GenerateReviewStep({
  extractSessionId,
  onFinalize,
  onQuit,
  livePreview = true,
  spaceId = '',
  environmentId = '',
  cmaToken = '',
  host = '',
  tokensPath = '',
  initialFinalizeError = null,
}: GenerateReviewStepProps): React.ReactElement {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;

  const [components, setComponents] = useState<CdfReviewEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // INTEG-4411 duplicate-cursor fix: cursor position is a visible-row index
  // (into `visibleRowsMemo`), not an item-index into `components`. When a
  // shared dep like `Card` appears under multiple parents, each occurrence is
  // its own row with the same `itemIdx` — an item-indexed cursor renders
  // "selected" on every occurrence and snaps back to the first one on j/k.
  // `selectedIdx` (the item-index of the component currently under the
  // cursor) is derived below from `visibleRowsMemo[cursorRowIdx]`.
  const [nav, setNav] = useState<{ cursorRowIdx: number; sidebarScrollOffset: number }>({
    cursorRowIdx: 0,
    sidebarScrollOffset: 0,
  });
  const cursorRowIdx = nav.cursorRowIdx;
  const sidebarScrollOffset = nav.sidebarScrollOffset;
  const [jsonScrollOffset, setJsonScrollOffset] = useState(0);
  const [sidebarFocused, setSidebarFocused] = useState(true);
  const [showFinalize, setShowFinalize] = useState(false);
  const [showQuit, setShowQuit] = useState(false);
  // FieldEditor is the default editor. JSON view is an opt-in read-only toggle.
  const [showJson, setShowJson] = useState(false);
  const [draftValue, setDraftValue] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  // INTEG-4411: inline banner shown when the operator tries to finalize
  // with zero accepted components. Cleared on the next 'a' or 'A' press.
  const [finalizeError, setFinalizeError] = useState<string | null>(initialFinalizeError);
  // Feature 1: per-component review metadata (rationale + source location)
  // for the currently-selected component. Reloaded when selection changes.
  const [reviewMetadata, setReviewMetadata] = useState<ComponentReviewMetadata | null>(null);
  // Feature 2: per-component preview annotations refreshed after every
  // FieldEditor save via the useLivePreview hook below. Empty when live
  // preview is disabled, when creds are missing, or before the first response.
  const [previewAnnotations, setPreviewAnnotations] = useState<Map<string, PreviewAnnotation>>(new Map());
  // Pilot-2026-06-24: raw removed list for the `d` detail panel. The
  // annotation map only carries kind, not the rich summaries we need to list
  // names/ids when the operator asks "which ones?".
  const [removedComponents, setRemovedComponents] = useState<ComponentTypeSummary[]>([]);
  // A2-2: when the removed-components banner is tall, `[d]` collapses its
  // detail rows. The 1-line count header stays visible so the operator knows
  // removed components exist. Gated to `sidebarFocused` so it can't collide
  // with FieldEditor text entry.
  const [removedBannerCollapsed, setRemovedBannerCollapsed] = useState(false);
  const removedBannerDefaultedRef = useRef(false);
  // Lifted rationale + source panels (replaces FieldEditor's right pane).
  // Mutually exclusive states.
  const [panelOpen, setPanelOpen] = useState<'none' | 'prop-rationale' | 'component-rationale' | 'source'>('none');
  const [panelScrollOffset, setPanelScrollOffset] = useState(0);
  const [textEntryActive, setTextEntryActive] = useState(false);
  const [componentRationale, setComponentRationale] = useState<ComponentRationale | null>(null);
  // Tracks the first `g` of a potential `gg` double-tap (jumps to top in
  // JSON-view + panel-focused state). Reset on any non-`g` key.
  const pendingGRef = useRef(false);
  // INTEG-4401: slot-dependency cycles loaded from the session DB. Non-empty
  // triggers sidebar (cycle) badges, banner + [c] detail-panel affordance,
  // and (at push time) a hard block.
  const [slotCycles, setSlotCycles] = useState<StoredSlotCycle[]>([]);
  // T10 — cycle panel open/close via shared hook. The scroll state stays
  // step-local since it's not part of the shared close-key convention;
  // it's reset on close by the caller's toggle handlers.
  const [cyclePanelScroll, setCyclePanelScroll] = useState(0);
  // A8 (spec §4) — GR↔SG cycle-list jump parity. The `[c]` panel is now a
  // jumpable list: `cyclesCursor` selects a cycle and Enter jumps the main
  // sidebar cursor to that cycle's canonical root. Mirrors ScopeGateStep's
  // `cyclesJumpables` behavior. Kept inline (not a shared component) because
  // GR's panel renders per-cycle `suggestedBreak` "Suggested fix:" lines +
  // colorized path segments that SG's simpler list does not.
  const [cyclesCursor, setCyclesCursor] = useState(0);
  const cyclePanel = useOverlayPanel({
    toggleKey: 'c',
    onClose: () => {
      setCyclePanelScroll(0);
      setCyclesCursor(0);
    },
  });
  // A9 (spec §4) — interactive break-cycle overlay. Opened with `[x]` from the
  // `[c]` cycle list; enumerates the removable slot-allowed edges for the
  // HIGHLIGHTED cycle (via `enumerateCycleBreaks`), lets the operator scroll +
  // Enter-to-delete a slot edge. The delete flows through the SAME undoable
  // slot-edit seam as FieldEditor saves (setComponents + storeCDFComponents +
  // recomputeCycles + pushHistorySnapshot), so Ctrl+Z restores it. `[b]` was
  // taken by the breaking-changes banner and `[c]` opens the parent list, so
  // `[x]` (mnemonic: "x out" / cut a slot edge) is the free, unambiguous key.
  const breakPanel = useOverlayPanel({
    toggleKey: 'x',
    onClose: () => {
      setBreakCursor(0);
      setBreakConfirm(false);
    },
  });
  const [breakCursor, setBreakCursor] = useState(0);
  // When true, the overlay shows the [y]/[n] confirm prompt for the currently
  // highlighted break edge (reuses the reject-cascade confirm-dialog pattern).
  const [breakConfirm, setBreakConfirm] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const seededGroupsRef = useRef(false);
  // Fuzzy-search overlay (mirrors ScopeGateStep). `/` opens the input;
  // Enter closes but preserves the query so dim persists; Tab cycles matches
  // once the input is closed; Esc from input closes+clears, Esc from
  // sidebar-with-active-query clears.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // L4 — Tab autocomplete possibilities strip. Populated when Tab finds >1
  // prefix-match; cleared on the next keystroke/backspace/close.
  const [autocompleteCandidates, setAutocompleteCandidates] = useState<string[]>([]);
  // T5b (layout plan §B) — jump-and-filter target. Mirrors ScopeGateStep T5:
  // independent of `searchQuery`; OR-merged into `filterVisibleKeys` with
  // jump-target winning priority. Esc clears this before clearing the
  // search-query.
  const [jumpFilterTarget, setJumpFilterTarget] = useState<string | null>(null);
  // T6 (parity plan §3) — lineage panel state. Sidebar-only overlay showing
  // ancestors + descendants of the focused component. Same shape as
  // ScopeGateStep; derivation happens via the shared `useLineage` hook so
  // both callsites render pixel-identical panels.
  const lineagePanel = useOverlayPanel({ toggleKey: 'l' });
  const [lineageCursor, setLineageCursor] = useState(0);
  // L6 (lifecycle plan §5 L6 + §5.1 Q2) — breaking-changes goto-banner. The
  // rich per-component detail (reasons + downstream impact) is discarded by the
  // `previewAnnotations` map, so we stash it here from `handleLivePreviewResult`
  // and surface it via a `[b]` overlay mirroring the lineage panel. `[b]` opens;
  // ↑/↓/j/k move the cursor; Enter jumps the main selection + closes.
  const breakingPanel = useOverlayPanel({ toggleKey: 'b' });
  const [breakingChanges, setBreakingChanges] = useState<BreakingComponent[]>([]);
  const [breakingCursor, setBreakingCursor] = useState(0);
  // BD4 — deferred FieldEditor focus target. Set when the operator jumps from a
  // breaking-change row (Enter) so the FieldEditor opens focused + scrolled to
  // the exact changed field. Cleared when the operator leaves that component
  // (jumpCursorToName / any cursor move) so a later manual entry into the
  // editor doesn't re-jump. Shape accepts slot targets for BD2's later drop-in.
  const [pendingEditorFocus, setPendingEditorFocus] = useState<{
    componentName: string;
    target: { kind: 'prop' | 'slot'; name: string };
  } | null>(null);
  // T8 (parity plan §3) — Column-1 view mode. `'grouped'` (default) uses the
  // tiered cycle/empty/composite/standalone layout; `'flat'` flattens to
  // an alphabetical list with `(N deps)` suffixes on composite roots. Mirrors
  // ScopeGateStep's `columnOneView` — kept inline (rather than a shared hook)
  // because the state + handler pattern is ~10 lines per step.
  const [columnOneView, setColumnOneView] = useState<'grouped' | 'flat'>('grouped');
  // L8 — category filters (broken / cycles). Each is an independent toggle;
  // multiple active filters UNION their key sets. L11 removed the "deleted"
  // filter that once lived here.
  const [activeFilters, setActiveFilters] = useState<Set<FilterCategory>>(new Set());
  // Task #37 — mount-time cycle auto-reject bookkeeping. `autoRejected`
  // tracks which components were flipped to `rejected` by the auto-reject
  // effect so the banner can enumerate them and `[u]` undo can restore only
  // that specific delta. `undoSnapshot` captures the pre-mount review-status
  // for every affected component so undo restores it byte-for-byte. When
  // `undoSnapshot === null`, the undo is spent (`[u]` is a no-op).
  const [autoRejected, setAutoRejected] = useState<string[]>([]);
  const [undoSnapshot, setUndoSnapshot] = useState<Map<string, ReviewComponentStatus> | null>(null);
  // T2 (parity plan §3, 2026-07-10) — auto-reject is a strict one-shot per
  // session. Once the mount-time effect fires, this ref latches to `true` and
  // the effect never fires again — regardless of subsequent edits, cycle
  // emergence, or cycle disappearance. Replaces the earlier signature-based
  // re-fire guard which allowed edit-driven re-fires. Decision seam lives in
  // `./auto-reject-decision.ts` so the invariant is pinned by pure-fn tests.
  const autoRejectFiredRef = useRef<boolean>(false);

  // T5 (parity plan §3) — unsaved-changes warning on Tab-away.
  //   - `editorDirty` mirrors FieldEditor's internal dirty predicate (set
  //     via its `onDirtyChange` callback).
  //   - `showUnsavedWarning` gates rendering of the inline yellow warning
  //     dialog.
  //   - `pendingFocusAway` remembers the deferred cross action so Enter/Esc
  //     from the warning can complete it after save-or-discard.
  //   - `discardTrigger` is a monotonic counter passed to FieldEditor;
  //     bumping it reverts the internal draft to the last-saved value.
  const [editorDirty, setEditorDirty] = useState(false);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [pendingFocusAway, setPendingFocusAway] = useState<null | 'tab-to-sidebar'>(null);
  const [discardTrigger, setDiscardTrigger] = useState(0);

  // T4 (parity plan §3) — undo/redo history stack.
  //   - `historyRef` lazily instantiates once the initial load completes so the
  //     seed snapshot reflects the post-load, pre-auto-reject state. The mount
  //     auto-reject then pushes ITS post-flip snapshot on top, so Cmd+Z from
  //     the auto-rejected state correctly restores the pre-auto-reject state.
  //   - `showReloadDialog` gates the inline Ctrl+R confirm affordance. On
  //     Enter, `reloadFromSave` re-runs the mount load path and resets the
  //     stack via `historyRef.current.reset(newSeed)`.
  //   - Undo/redo restore snapshots IN-MEMORY only. `storeCDFComponents` is
  //     never invoked on undo — reload-from-save is the escape hatch for
  //     "the DB is right, my in-memory is wrong."
  const historyRef = useRef<HistoryStack | null>(null);
  const historySeededRef = useRef(false);
  const [showReloadDialog, setShowReloadDialog] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const handleLivePreviewResult = (response: ServerPreviewResponse | null): void => {
    if (!response) return;
    setPreviewAnnotations(
      applyPreviewAnnotations(
        response,
        components.map((c) => c.key),
      ),
    );
    const nextRemoved = response.components.removed ?? [];
    setRemovedComponents(nextRemoved);
    if (!removedBannerDefaultedRef.current && nextRemoved.length > 0) {
      removedBannerDefaultedRef.current = true;
      setRemovedBannerCollapsed(nextRemoved.length > 5);
    }
    setBreakingChanges(deriveBreakingChanges(response));
  };

  const livePreviewHook = useLivePreview({
    enabled: livePreview,
    sessionId: extractSessionId,
    tokensPath,
    spaceId,
    environmentId,
    cmaToken,
    host,
    onResult: handleLivePreviewResult,
  });

  // Manual spinner cycling (no extra dep) for the sidebar status-row
  // indicator. Runs only while the live-preview hook reports `running`.
  const SPINNER_FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  const [spinnerTick, setSpinnerTick] = useState(0);
  useEffect(() => {
    if (livePreviewHook.status !== 'running') return;
    const id = setInterval(() => setSpinnerTick((t) => t + 1), 80);
    return () => clearInterval(id);
  }, [livePreviewHook.status]);
  const livePreviewSpinner = SPINNER_FRAMES[spinnerTick % SPINNER_FRAMES.length];

  // Load path extracted so `reloadFromSave` (T4 Ctrl+R affordance) can re-run
  // it without duplicating the DB access pattern. Pure w.r.t. React state:
  // returns the shaped review entries + cycles; the caller commits them.
  const loadSessionState = (): {
    entries: CdfReviewEntry[];
    cycles: StoredSlotCycle[];
    error: string | null;
  } => {
    const db = openPipelineDb();
    let cdfComponents: Array<{ key: string; entry: CDFComponentEntry }> = [];
    let cycles: StoredSlotCycle[] = [];
    try {
      cdfComponents = loadCDFComponents(db, extractSessionId);
      cycles = loadSlotCycles(db, extractSessionId);
    } finally {
      db.close();
    }
    if (cdfComponents.length === 0) {
      return { entries: [], cycles: [], error: 'No generated definitions found for this session. Try re-running generate.' };
    }
    const cycleParticipants = new Set<string>();
    for (const c of cycles) for (const p of c.path) cycleParticipants.add(p);
    const reviewEntries: CdfReviewEntry[] = cdfComponents.map(({ key, entry }) => ({
      key,
      entry,
      status: 'needs-review',
    }));
    return {
      entries: sortComponentsForSidebar(reviewEntries, cycleParticipants),
      cycles,
      error: null,
    };
  };

  useEffect(() => {
    try {
      const { entries, cycles, error } = loadSessionState();
      if (error) {
        setLoadError(error);
        setLoading(false);
        return;
      }
      setSlotCycles(cycles);
      setComponents(entries);
      setLoading(false);
    } catch (e: unknown) {
      setLoadError(String(e));
      setLoading(false);
    }
  }, []);

  // Pilot-2026-06-23 R2: fire the live preview once on entry to final-review
  // so diff badges populate before the operator's first save. We gate on the
  // livePreview prop to honor --no-live-preview without depending on the
  // hook's internal short-circuit. Cred-missing is still handled by the
  // hook's own no-op path.
  useEffect(() => {
    if (loading) return;
    if (!livePreview) return;
    if (components.length === 0) return;
    livePreviewHook.trigger();
    // Intentionally only on load completion — subsequent fires happen via
    // handleEditSave. Adding livePreviewHook to deps would re-fire on every
    // hook re-creation.
  }, [loading]);

  const handleFinalizeConfirm = () => {
    // Strict opt-in: only EXPLICITLY ACCEPTED components ship. Anything left
    // in 'needs-review' OR explicitly 'rejected' is downgraded to
    // 'generate-rejected' so loadCDFComponents excludes it from the manifest.
    // The operator told us they want accept-to-ship semantics — leaving a
    // component unresolved should NOT silently push it (Pilot-2026-06-24 R2).
    const acceptedCount = components.filter((c) => c.status === 'accepted').length;
    // INTEG-4411 refined: DO NOT block on `acceptedCount === 0` up-front.
    // A push with zero accepted but one or more rejections targeting a
    // component that exists server-side still produces REMOVALS — a valid
    // push, not a no-op. Same for token-only diffs. The load-bearing no-op
    // check lives downstream in WizardApp.runPreview, which consults the
    // preview response and only blocks when every diff bucket is empty.
    // We keep the `finalizeError` state so the wizard can route back here
    // with an inline banner when that downstream check fires.
    const explicitlyRejected = components.filter((c) => c.status === 'rejected').map((c) => c.key);
    const unresolved = components.filter((c) => c.status === 'needs-review').map((c) => c.key);
    const toReject = [...explicitlyRejected, ...unresolved];
    if (toReject.length > 0) {
      const db = openPipelineDb();
      try {
        const stmt = db.prepare(
          `UPDATE raw_components SET status = 'generate-rejected' WHERE session_id = ? AND name = ?`,
        );
        db.exec('BEGIN');
        try {
          for (const name of toReject) {
            stmt.run(extractSessionId, name);
          }
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      } finally {
        db.close();
      }
    }
    onFinalize(acceptedCount, explicitlyRejected.length, unresolved.length);
  };

  /**
   * INTEG-4401 (Fix 3/4): re-run cycle detection against the current in-memory
   * component state and, if the result differs from the persisted `slotCycles`
   * state, update both React state and the session DB. Called from:
   *  - `handleEditSave` after a FieldEditor save mutates a slot's
   *    `$allowedComponents`, so the banner / sidebar badges / [c] panel reflect
   *    reality instead of the stale extract-time snapshot.
   *  - The `r` reject keystroke, since dropping a component from the manifest
   *    can collapse cycles that routed through it.
   *
   * Rejected components are excluded from the graph — they will never ship, so
   * they cannot contribute to a real push-time cycle even if their slot config
   * still references other components locally.
   *
   * Cheap for typical N: findSlotCycles is O((V+E)(C+1)) and most manifests
   * have zero or a handful of cycles. Wrapped in try/catch so a malformed
   * $slots shape can't crash the render pipeline.
   */
  const recomputeCycles = (currentComponents: CdfReviewEntry[]): void => {
    try {
      // Compute the reified CycleView (ADR-0010 Part 3 / plan §4.2) and wrap
      // its `pushBlocking` cycles into `StoredSlotCycle` for persistence. The
      // `structural` arm is derived at render time by `cycleView` and is NOT
      // persisted. Preserves today's drop-the-rows semantics for the filtered
      // arm (rejected components contribute no rows and no edges).
      const view = computeCycleView(currentComponents);
      const rawCycles = view.pushBlocking;
      const next: StoredSlotCycle[] = rawCycles.map((cycle) => ({
        path: cycle.path,
        edges: cycle.edges,
        suggestedBreak: cycle.edges.length > 0 ? suggestCycleBreakEdge(cycle, rawCycles) : null,
      }));
      // Cheap structural equality via JSON.stringify — cycle count is tiny and
      // this only fires on user actions, not on every render.
      const prevSerialized = JSON.stringify(slotCycles);
      const nextSerialized = JSON.stringify(next);
      if (prevSerialized === nextSerialized) return;
      setSlotCycles(next);
      const db = openPipelineDb();
      try {
        storeSlotCycles(db, extractSessionId, next);
      } finally {
        db.close();
      }
      // If the new cycle set is empty, clear any lingering finalize error the
      // [F] guard may have surfaced. Otherwise leave it alone.
      if (next.length === 0) setFinalizeError(null);
    } catch {
      // Defensive: swallow — never let cycle detection crash the review UI.
    }
  };

  // Composite-components grouping wiring. Hooks must live above every early
  // return so React's hook-count stays constant across the loading↔loaded
  // transition. Derives the closure set from the in-memory `components`
  // state's `$slots` shape so edits + rejections propagate on the next
  // render tick without a DB round-trip.
  // ADR-0010 §C.1 two-graph split — this is the UNFILTERED arm. Every
  // component contributes its slot edges regardless of `status`. Consumers:
  // `computeAllClosures`, `computeAcceptCascade` / `computeRejectCascade`, and
  // task #37 `computeCycleAutoRejectTargets`. Cycle detection now lives in
  // `cycleView` (see below). The sidebar's tier layout does NOT read this
  // graph — it reads `sidebarGraph` below (rejected rows contribute no edges
  // there) so rejected ancestors don't drag their former targets under them.
  const componentGraph = useMemo<ComponentGraphNode[]>(
    () => buildComponentGraph(components),
    [components],
  );
  // Sidebar-layout arm: rejected components contribute no outgoing edges
  // (ADR-0010 Part 3, plan §4.3). Passed into `GroupedSidebar.graph` so
  // tier layout, cycle-child injection, and closure walking read from one
  // canonical source. Rejected rows still appear as rows (they map to
  // `{ name, slots: [] }`), but their former slot targets are promoted back
  // to standalones.
  const sidebarGraph = useMemo<ComponentGraphNode[]>(
    () => buildComponentGraph(components, { stripRejectedEdges: true }),
    [components],
  );
  const closures = useMemo(() => computeAllClosures(componentGraph), [componentGraph]);
  useEffect(() => {
    if (seededGroupsRef.current) return;
    if (closures.size === 0 && slotCycles.length === 0) return;
    seededGroupsRef.current = true;
    const seed = new Set<string>(closures.keys());
    for (const cyc of slotCycles) for (const p of cyc.path) seed.add(p);
    setExpandedGroups(seed);
  }, [closures, slotCycles]);
  // Direct issues per component. Wired signals:
  //   - status === 'rejected'   → error (dropping a leaf breaks its ancestors)
  // Cycle- and empty-tier components live in their own tiers in
  // GroupedSidebar and deliberately do NOT feed the inheritance layer (they
  // aren't part of any group closure anyway).
  const directIssues = useMemo<Map<string, NodeStatus>>(() => {
    const m = new Map<string, NodeStatus>();
    for (const c of components) {
      if (c.status === 'rejected') m.set(c.key, 'error');
    }
    return m;
  }, [components]);
  // Reified two-graph split (ADR-0010 Part 3 / plan §4.2). `cycleView.structural`
  // is the sidebar cycle tier — every component that participates in a slot
  // cycle whether or not the cycle survives the reject-filter used by
  // `slotCycles` for push-safety. Otherwise cycle members whose only path in
  // the sidebar was via a composite ancestor get orphaned once the operator
  // rejects that ancestor: `computeAllClosures` short-circuits closures that
  // hit a cycle → the ancestor's closure loses its descendants → and the
  // filtered `slotCycles` no longer classifies the members as cycle
  // participants → they disappear from the visible list. Detecting cycles on
  // the full unfiltered graph keeps them in the cycle tier.
  //
  // `cycleView.pushBlocking` is the source-of-truth for push-safety cycles at
  // render time; the persisted `slotCycles` state still exists because it
  // carries the `suggestedBreak` field + is the DB shape. `recomputeCycles`
  // keeps them in lockstep whenever the operator edits/rejects.
  const cycleView = useMemo<CycleView>(() => computeCycleView(components), [components]);

  // T2 (parity plan §3, 2026-07-10) — mount-time auto-reject is a STRICT
  // ONE-SHOT per session. Fires exactly once, on the first post-load render
  // where at least one structural cycle exists. After firing, latches
  // `autoRejectFiredRef` and never fires again — regardless of edits,
  // cycle emergence, cycle disappearance, or undo. This is a semantic revert
  // of task #37's "re-fire on edit-induced new cycle" branch: auto-reject
  // is meant to be a "welcome to this screen, here are the cycles we found
  // at load" gesture, not an ongoing enforcer.
  //
  // The sidebar `(cycle)` badges, push-safety banner, `[F]` gate, and `[c]`
  // cycle panel all still track live cycles via `cycleView` / `slotCycles`
  // — that infrastructure is independent of auto-reject.
  //
  // The `[u]` undo remains a single-shot restore of the pre-mount snapshot.
  useEffect(() => {
    const decision = computeAutoRejectDecision({
      loading,
      autoRejectFired: autoRejectFiredRef.current,
      hasCycle: cycleView.structural.size > 0,
    });
    if (decision === 'skip') return;
    autoRejectFiredRef.current = true;
    const targets = computeCycleAutoRejectTargets(slotCycles, componentGraph);
    if (targets.size === 0) return;
    // Compute the snapshot + flipped list from the current `components`
    // reference. Safe against React strict-mode's double-invocation of the
    // setComponents updater below because we snapshot BEFORE calling
    // setComponents and the effect's signature guard prevents re-entry.
    const snapshot = new Map<string, ReviewComponentStatus>();
    const flipped: string[] = [];
    for (const c of components) {
      if (!targets.has(c.key)) continue;
      snapshot.set(c.key, c.status);
      if (c.status !== 'rejected') flipped.push(c.key);
    }
    setComponents((prev) =>
      prev.map((c) =>
        targets.has(c.key) ? { ...c, status: 'rejected' as ReviewComponentStatus } : c,
      ),
    );
    // Even when nothing actually flipped (already all rejected), still record
    // which components are the auto-reject targets so the banner explains
    // WHY they are rejected. Undo, however, is only armed when there's a
    // real delta to restore.
    setAutoRejected(flipped.length > 0 ? flipped : [...targets].sort());
    setUndoSnapshot(flipped.length > 0 ? snapshot : null);
  }, [loading, cycleView, componentGraph, slotCycles]);

  // T4 (parity plan §3) — seed the history stack once the initial load has
  // completed. Sequencing matters: seed with `S0` = post-load, pre-auto-reject
  // state on the first non-loading render. The auto-reject effect above then
  // pushes its post-flip snapshot onto the stack (see `pushHistorySnapshot`
  // wiring below) so Cmd+Z from the auto-rejected state returns to S0.
  useEffect(() => {
    if (loading) return;
    if (historySeededRef.current) return;
    historySeededRef.current = true;
    historyRef.current = createHistoryStack({
      components: components.map((c) => ({ key: c.key, entry: c.entry, status: c.status })),
      autoRejected: [],
      undoSnapshot: null,
    });
  }, [loading, components]);

  // Push a snapshot of the CURRENT (post-mutation) state onto the history
  // stack. Callers invoke this AFTER the state update they want captured, with
  // the fresh values passed in explicitly so the push doesn't chase stale
  // closures. `label` is captured for future debugging (currently unused).
  const pushHistorySnapshot = (
    entries: CdfReviewEntry[],
    autoRej: string[],
    undoSnap: Map<string, ReviewComponentStatus> | null,
    label: string,
  ): void => {
    if (!historyRef.current) return;
    historyRef.current.push(
      {
        components: entries.map((c) => ({ key: c.key, entry: c.entry, status: c.status })),
        autoRejected: [...autoRej],
        undoSnapshot: undoSnap === null ? null : new Map(undoSnap),
      },
      label,
    );
  };

  // Auto-reject pushes its post-flip snapshot exactly once, right after it
  // fires. Guarded by an internal ref so React strict-mode's double invocation
  // can't double-push.
  const autoRejectPushedRef = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (!historySeededRef.current) return;
    if (!autoRejectFiredRef.current) return;
    if (autoRejectPushedRef.current) return;
    autoRejectPushedRef.current = true;
    pushHistorySnapshot(components, autoRejected, undoSnapshot, 'mount-auto-reject');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRejected]);

  const applyHistorySnapshot = (snap: HistorySnapshot): void => {
    // Rehydrate visible state from the snapshot. `slotCycles` / `cycleView` /
    // `expandedGroups` derive from `components`, so we don't touch them
    // directly (they'll recompute on the next render). We DO restore
    // `autoRejected` + `undoSnapshot` because they drive the banner and the
    // legacy `[u]` alias respectively.
    const restored: CdfReviewEntry[] = snap.components.map((c) => ({
      key: c.key,
      entry: c.entry,
      status: c.status,
    }));
    setComponents(restored);
    setAutoRejected(snap.autoRejected);
    setUndoSnapshot(snap.undoSnapshot);
    // Cycle detection may need to rerun against the restored graph so the
    // sidebar `(cycle)` badges stay in sync. `recomputeCycles` no-ops when
    // nothing changed.
    recomputeCycles(restored);
  };

  const handleUndo = (): void => {
    const snap = historyRef.current?.undo();
    if (!snap) return;
    applyHistorySnapshot(snap);
  };

  const handleRedo = (): void => {
    const snap = historyRef.current?.redo();
    if (!snap) return;
    applyHistorySnapshot(snap);
  };

  const reloadFromSave = (): void => {
    try {
      const { entries, cycles, error } = loadSessionState();
      if (error) {
        setLoadError(error);
        return;
      }
      setSlotCycles(cycles);
      setComponents(entries);
      // A2-1: seed the expanded set DIRECTLY from the freshly loaded state
      // (reusing the [E] expand-all recipe) instead of emptying it, so grouped
      // parents stay expanded after reload exactly as on first mount. Derived
      // from `entries`/`cycles` because `closures`/`cycleView` are memos of the
      // still-stale `components` state at this point.
      const reloadGraph = buildComponentGraph(entries);
      const reloadClosures = computeAllClosures(reloadGraph);
      const reloadCycleView = computeCycleView(entries);
      const reloadSeed = new Set<string>();
      for (const [name, closure] of reloadClosures.entries()) {
        if (closure.nodes.length > 1) reloadSeed.add(name);
      }
      for (const name of reloadCycleView.structural) reloadSeed.add(name);
      setExpandedGroups(reloadSeed);
      seededGroupsRef.current = true;
      setAutoRejected([]);
      setUndoSnapshot(null);
      // Reset one-shot latches so mount auto-reject fires again for the
      // reloaded state. `autoRejectPushedRef` re-arms so the auto-reject
      // effect's history push runs against the fresh seed.
      autoRejectFiredRef.current = false;
      autoRejectPushedRef.current = false;
      historyRef.current?.reset({
        components: entries.map((c) => ({ key: c.key, entry: c.entry, status: c.status })),
        autoRejected: [],
        undoSnapshot: null,
      });
      setNav({ cursorRowIdx: 0, sidebarScrollOffset: 0 });
      setSaveError(null);
      setFinalizeError(null);
    } catch (e: unknown) {
      setLoadError(String(e));
    }
  };
  const groupedItemsMemo = useMemo(
    () =>
      components.map((c) => ({
        key: c.key,
        entry: c.entry,
        status: (directIssues.get(c.key) ?? 'ok') as NodeStatus,
      })),
    [components, directIssues],
  );
  // GA-1 A3 — the `[w]` filter is "only breaking changes": the components the
  // live-preview classified as `breaking`. We keep the internal FilterCategory
  // key `broken` (lower churn than renaming the category everywhere) but feed
  // it the breaking-change component names, and the user-facing label reads
  // "only breaking changes". Distinct from `directIssues` (rejected-leaf error
  // propagation), which is no longer surfaced as a filter.
  const brokenKeys = useMemo<Set<string>>(
    () => new Set(breakingChanges.map((b) => b.componentName)),
    [breakingChanges],
  );

  // BD4 — flatten breaking changes to one row PER CHANGE so the goto-banner
  // offers the finer jump the spec wants: each row carries its componentName +
  // the specific `focusTarget` prop. Components with no enumerated changes
  // still contribute a single component-level row (focusTarget undefined) so
  // the jump degrades to today's land-on-the-row behavior. `breakingCursor`
  // indexes THIS list.
  const breakingRows = useMemo<BreakingRow[]>(
    () => buildBreakingRows(breakingChanges),
    [breakingChanges],
  );

  const filterVisibleKeys = useMemo<Set<string> | undefined>(() => {
    // T5b: jump-filter takes priority over the T4 search-neighborhood filter.
    // When active, the sidebar shows only the target + its transitive
    // ancestors — search + category filters are set aside until Esc clears
    // the jump.
    if (jumpFilterTarget) {
      return findAllAncestorsInclusive(jumpFilterTarget, sidebarGraph);
    }
    // L8: category filters (broken / cycles) → union of matching keys.
    const categoryKeys = computeFilterKeys({
      filters: activeFilters,
      data: { cycles: cycleView.structural, broken: brokenKeys },
    });
    const searchKeys = (() => {
      if (!searchQuery) return undefined;
      const matches = groupedItemsMemo
        .map((it) => it.key)
        .filter((k) => fuzzyMatches(searchQuery, k));
      if (matches.length === 0) return undefined;
      return computeDirectNeighborhood(matches, sidebarGraph);
    })();
    // Precedence: jump (above) → category ∩ search → whichever is active.
    return intersectFilterKeys(categoryKeys, searchKeys);
  }, [
    jumpFilterTarget,
    activeFilters,
    cycleView,
    brokenKeys,
    searchQuery,
    groupedItemsMemo,
    sidebarGraph,
  ]);

  const visibleRowsMemo = useMemo<VisibleRow[]>(
    () =>
      buildVisibleRows({
        items: groupedItemsMemo,
        cycleParticipants: cycleView.structural,
        expandedGroups,
        viewMode: columnOneView,
        graph: sidebarGraph,
        filterVisibleKeys,
      }),
    [groupedItemsMemo, cycleView, expandedGroups, columnOneView, sidebarGraph, filterVisibleKeys],
  );
  // Row positions that map to a real component (skip synthetic flat-header
  // rows). j/k navigation walks these in order, so duplicate occurrences of
  // the same itemIdx (shared deps under multiple parents) each get their own
  // stop instead of being deduped.
  const selectableRowPositions = useMemo<number[]>(() => {
    const out: number[] = [];
    for (let i = 0; i < visibleRowsMemo.length; i++) {
      if (visibleRowsMemo[i].itemIdx >= 0) out.push(i);
    }
    return out;
  }, [visibleRowsMemo]);
  // Derived item-index of the component currently under the cursor. Used by
  // logic that needs to know WHICH component is focused (which detail panel
  // to render, which entry to accept/reject, etc.) — never for rendering the
  // sidebar cursor position (that's cursorRowIdx via selectedRowIdx).
  const selectedIdx =
    visibleRowsMemo[cursorRowIdx]?.itemIdx ?? -1;
  // T6 — derive lineage panel entries + jumpables. Uses the UNFILTERED
  // `componentGraph` per ADR-0010 §Part 1 (rejected components still
  // contribute structural lineage). Shared with ScopeGateStep via the same
  // hook so both steps render pixel-identical panels.
  const focusedComponentKey: string | null = components[selectedIdx]?.key ?? null;
  const { entries: lineageEntries, jumpables: lineageJumpables } = useLineage(
    focusedComponentKey,
    componentGraph,
  );

  // L2e — autoscale the frame to the terminal height (mirrors ScopeGateStep).
  // The sidebar's visible-row budget is sized from `stdout.rows` minus the
  // always-on chrome so the total frame fits even on small terminals with the
  // panel CLOSED; Ink then diffs in place instead of clearing + repainting each
  // cursor move (the flash). Panel-open window sizing is unified here too
  // (L2c/L2d). Scroll math below uses `visibleCount`.
  const { sidebarVisibleCount: visibleCount, panelMaxRows } = computeSidebarBudget({
    rows: stdout?.rows ?? FALLBACK_ROWS,
    panelOpen: lineagePanel.isOpen,
    entryCount: lineageEntries.length,
  });
  useEffect(() => {
    if (selectableRowPositions.length === 0) return;
    const cursorInRange = selectableRowPositions.includes(cursorRowIdx);
    // When the row list shrinks or reshuffles (e.g. an edit removes a cycle
    // and cycle-tier rows collapse into other tiers) the previously-in-range
    // scroll offset can point past the shorter list. Slicing then hides rows
    // before the stale offset. Clamp scroll to the largest offset that still
    // renders a full window (or 0 when the list fits entirely).
    const maxScroll = Math.max(0, visibleRowsMemo.length - visibleCount);
    const scrollNeedsClamp = sidebarScrollOffset > maxScroll;
    if (cursorInRange && !scrollNeedsClamp) return;
    const nextCursor = cursorInRange ? cursorRowIdx : selectableRowPositions[0];
    setNav(() => ({
      cursorRowIdx: nextCursor,
      sidebarScrollOffset: Math.min(sidebarScrollOffset, maxScroll),
    }));
  }, [selectableRowPositions, cursorRowIdx, sidebarScrollOffset, visibleRowsMemo.length, visibleCount]);

  // Feature 1: load review metadata (rationale + source location) for the
  // selected component when selection changes.
  useEffect(() => {
    const current = components[selectedIdx];
    if (!current) {
      setReviewMetadata(null);
      return;
    }
    const db = openPipelineDb();
    try {
      setReviewMetadata(loadComponentReviewMetadata(db, extractSessionId, current.key));
    } catch {
      setReviewMetadata(null);
    } finally {
      db.close();
    }
  }, [selectedIdx, components, extractSessionId]);

  // Load component-level rationale for the selected component (drives the
  // `I` ComponentRationalePanel). Decoupled from review metadata so the data
  // contracts can evolve independently.
  useEffect(() => {
    const current = components[selectedIdx];
    if (!current) {
      setComponentRationale(null);
      return;
    }
    const db = openPipelineDb();
    try {
      setComponentRationale(loadComponentRationale(db, extractSessionId, current.key));
    } catch {
      setComponentRationale(null);
    } finally {
      db.close();
    }
  }, [selectedIdx, components, extractSessionId]);
  // Merge per-closure render statuses into one map. When the same node
  // appears in multiple closures (shared dep), an entry with `isOwn: true`
  // wins over an `isOwn: false` — a real issue on a shared node beats the
  // inherited marker on its ancestor.
  const renderStatusByKey = useMemo<Map<string, RenderStatus>>(() => {
    const merged = new Map<string, RenderStatus>();
    for (const closure of closures.values()) {
      const per = computeRenderStatuses(closure, directIssues);
      for (const [name, rs] of per.entries()) {
        const existing = merged.get(name);
        if (!existing || (!existing.isOwn && rs.isOwn)) {
          merged.set(name, rs);
        }
      }
    }
    return merged;
  }, [closures, directIssues]);

  // Per-row selection glyph state ([✓]/[✗]/[ ]) driven by each component's
  // ReviewComponentStatus. `needs-review` and `reviewed` render as undecided
  // so operators can see at a glance what the auto-reject (task #37) touched
  // and what still awaits an explicit accept/reject.
  const selectionStateByKey = useMemo<Map<string, 'accepted' | 'rejected' | 'undecided'>>(() => {
    const map = new Map<string, 'accepted' | 'rejected' | 'undecided'>();
    for (const c of components) {
      if (c.status === 'accepted') map.set(c.key, 'accepted');
      else if (c.status === 'rejected') map.set(c.key, 'rejected');
      else map.set(c.key, 'undecided');
    }
    return map;
  }, [components]);

  // Visible-row match list drives the (N/M) count and Tab cycling. A "match"
  // is a row position (into visibleRowsMemo) whose component key fuzzy-hits
  // the query. Row positions (not item-indices) so duplicate occurrences of
  // a shared dep can each be visited independently.
  const searchMatches = useMemo<number[]>(() => {
    if (!searchQuery) return [];
    const out: number[] = [];
    for (const pos of selectableRowPositions) {
      const row = visibleRowsMemo[pos];
      const key = row ? components[row.itemIdx]?.key : undefined;
      if (key && fuzzyMatches(searchQuery, key)) out.push(pos);
    }
    return out;
  }, [searchQuery, selectableRowPositions, visibleRowsMemo, components]);
  // T7b delta 2 — display-only unique-component match count. `searchMatches`
  // stores row positions (Tab-cycling walks duplicate rows for shared deps
  // intentionally), but the user-visible numerator must be a component count
  // to parity with ScopeGate ("N unique matches / M total"). Dedupe by itemIdx.
  const searchMatchCount = useMemo<number>(() => {
    if (searchMatches.length === 0) return 0;
    const seen = new Set<number>();
    for (const pos of searchMatches) {
      const itemIdx = visibleRowsMemo[pos]?.itemIdx;
      if (itemIdx != null && itemIdx >= 0) seen.add(itemIdx);
    }
    return seen.size;
  }, [searchMatches, visibleRowsMemo]);

  // FB1 — flat view dims non-matches for active category filters / focus-
  // lineage (parity with search, which flat view already dims). Grouped view
  // continues to HIDE those non-matches via `filterVisibleKeys`, so the flat-
  // dim membership never narrows grouped rows. Search dimming still applies in
  // both views.
  const dimPredicate = useMemo(
    () =>
      buildFlatDimPredicate({
        viewMode: columnOneView,
        searchQuery,
        filterVisibleKeys,
      }),
    [columnOneView, searchQuery, filterVisibleKeys],
  );

  /**
   * Jump the cursor to a specific row position in `visibleRowsMemo`. Callers
   * that only know the target component name should use `jumpCursorToName`
   * so they land on the FIRST occurrence deterministically instead of e.g.
   * the last one from a linear scan.
   */
  const jumpCursorToRow = (rowIdx: number): void => {
    if (rowIdx < 0 || rowIdx >= visibleRowsMemo.length) return;
    setNav(({ sidebarScrollOffset: prev }) => {
      let nextOff = prev;
      if (rowIdx < prev) nextOff = rowIdx;
      else if (rowIdx >= prev + visibleCount) nextOff = rowIdx - visibleCount + 1;
      return { cursorRowIdx: rowIdx, sidebarScrollOffset: nextOff };
    });
    setJsonScrollOffset(0);
    setDraftValue('');
    setSaveError(null);
    // BD4 — any cursor jump lands on a (possibly) different component; drop the
    // pending editor-focus so it can't re-fire on a later navigation. The BD4
    // breaking-row Enter handler re-sets it AFTER calling jumpCursorToName.
    setPendingEditorFocus(null);
  };
  const jumpCursorToName = (name: string): void => {
    for (let i = 0; i < visibleRowsMemo.length; i++) {
      const row = visibleRowsMemo[i];
      if (row.itemIdx < 0) continue;
      if (components[row.itemIdx]?.key === name) {
        jumpCursorToRow(i);
        return;
      }
    }
  };

  const handleEditSave = () => {
    const current = components[selectedIdx];
    if (!current) return;
    try {
      const parsed = JSON.parse(draftValue) as Record<string, unknown>;
      // Accept both bare entry and wrapped { [key]: entry } forms
      const keys = Object.keys(parsed);
      const entry =
        keys.length === 1 && typeof parsed[keys[0]] === 'object' && parsed[keys[0]] !== null
          ? (parsed[keys[0]] as CDFComponentEntry)
          : (parsed as unknown as CDFComponentEntry);
      if (entry.$type !== 'component' || typeof entry.$properties !== 'object' || entry.$properties === null) {
        setSaveError('Invalid CDF entry: must have $type: "component" and $properties object');
        return;
      }
      let updatedComponents: CdfReviewEntry[] = [];
      setComponents((prev) => {
        updatedComponents = prev.map((c, i) =>
          i === selectedIdx ? { ...c, entry, status: c.status === 'needs-review' ? 'accepted' : c.status } : c,
        );
        return updatedComponents;
      });
      setDraftValue('');
      setSaveError(null);
      const db = openPipelineDb();
      try {
        storeCDFComponents(db, extractSessionId, [{ key: current.key, entry }]);
      } finally {
        db.close();
      }
      // INTEG-4401 (Fix 3/4): recompute cycles against the freshly-edited
      // component set so banner/badges/[c]-panel stay in sync. The FieldEditor
      // picker filters cycle-forming candidates, but free-text edits + JSON
      // pastes still slip through, and edits that BREAK an existing cycle
      // won't propagate without this call.
      recomputeCycles(updatedComponents);
      // Feature 2: re-fire the live preview now that pipeline.db reflects
      // the new state. The hook owns debounce + cred-missing short-circuit.
      livePreviewHook.trigger();
      // T4 — push the post-save snapshot onto the history stack. Undo will
      // revert the entry IN-MEMORY only; the DB write above stays intact.
      // Reload-from-save is the escape hatch to also re-read from DB.
      pushHistorySnapshot(updatedComponents, autoRejected, undoSnapshot, 'edit-save');
    } catch (e) {
      setSaveError(String(e));
    }
  };

  const handleEditDiscard = () => {
    setDraftValue('');
    setSaveError(null);
  };

  // A9 — the removable slot-allowed edges for the HIGHLIGHTED cycle only. Empty
  // when no cycle is highlighted (defensive) or the cycle is already resolved.
  const breakEdges = useMemo<BreakEdge[]>(() => {
    const cycle = slotCycles[cyclesCursor];
    if (!cycle) return [];
    return enumerateCycleBreaks(cycle, components);
  }, [slotCycles, cyclesCursor, components]);

  // A2-4 (spec §4b) — the distinct participants in the HIGHLIGHTED cycle,
  // offered as the second kind of break-overlay action: "reject component".
  // Derived from the same cycle `path` the overlay renders; the path repeats
  // its first element as its last so the loop closes, so we dedupe.
  const breakMembers = useMemo<string[]>(() => {
    const cycle = slotCycles[cyclesCursor];
    if (!cycle) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of cycle.path) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
    return out;
  }, [slotCycles, cyclesCursor]);

  // A9 — delete a slot-allowed edge to break a cycle. Reuses the exact undoable
  // slot-edit seam that FieldEditor saves flow through: mutate the component's
  // `$slots[slot].$allowedComponents` in review state, persist via
  // storeCDFComponents, recompute cycles so the resolved cycle drops out, and
  // push a history snapshot so Ctrl+Z restores the edge. Does NOT touch review
  // status (this is a slot-edge edit, not a reject).
  const handleBreakEdge = (edge: BreakEdge): void => {
    const idx = components.findIndex((c) => c.key === edge.fromComponent);
    if (idx < 0) return;
    const target = components[idx];
    const slot = target.entry.$slots?.[edge.slotName];
    if (!slot || !Array.isArray(slot.$allowedComponents)) return;
    const nextAllowed = slot.$allowedComponents.filter((v) => v !== edge.toComponent);
    const nextEntry: CDFComponentEntry = {
      ...target.entry,
      $slots: {
        ...target.entry.$slots,
        [edge.slotName]: { ...slot, $allowedComponents: nextAllowed },
      },
    };
    const next = components.map((c, i) => (i === idx ? { ...c, entry: nextEntry } : c));
    setComponents(next);
    const db = openPipelineDb();
    try {
      storeCDFComponents(db, extractSessionId, [{ key: target.key, entry: nextEntry }]);
    } finally {
      db.close();
    }
    recomputeCycles(next);
    livePreviewHook.trigger();
    pushHistorySnapshot(next, autoRejected, undoSnapshot, 'break-cycle-edge');
  };

  // Task #37 reject-cascade, factored out of the sidebar `[r]` handler so the
  // A2-4 break-overlay "reject component" entries can drive the IDENTICAL flow.
  // Reject cascades UP to ancestors AND deselects descendants back to
  // `needs-review` (scope-gate's tri-state cascade). Applies immediately (no
  // confirm), recomputes cycles against the post-update graph, and pushes a
  // history snapshot so Ctrl+Z restores the prior status.
  const handleRejectComponent = (key: string): void => {
    const rejectCascade = computeRejectCascade(key, componentGraph);
    const acceptCascade = computeAcceptCascade(key, componentGraph);
    const next = components.map((c) => {
      if (rejectCascade.has(c.key)) {
        return { ...c, status: 'rejected' as ReviewComponentStatus };
      }
      if (acceptCascade.has(c.key) && c.key !== key) {
        return { ...c, status: 'needs-review' as ReviewComponentStatus };
      }
      return c;
    });
    setComponents(next);
    recomputeCycles(next);
    pushHistorySnapshot(next, autoRejected, undoSnapshot, 'reject-cascade');
  };

  const dialogOpen = showFinalize || showQuit;

  useImmediateInput((input, key) => {
    if (loading || loadError) return;
    if (dialogOpen) return;
    // Help overlay owns all input while open — the HelpOverlay component's own
    // handler closes it on `?`/Esc, so here we simply swallow everything else.
    if (showHelp) return;

    // T4 (parity plan §3) — reload-from-save confirm dialog owns keystrokes
    // when open. Enter re-runs the load path + resets history; Esc cancels.
    if (showReloadDialog) {
      if (key.return) {
        reloadFromSave();
        setShowReloadDialog(false);
        return;
      }
      if (key.escape) {
        setShowReloadDialog(false);
        return;
      }
      return;
    }

    // T4 — top-level undo/redo/reload keybindings. Gated above sidebar-focused
    // vs panel-focused vs overlay checks so they work uniformly across states.
    // Advertised keys are Ctrl+Z / Ctrl+Y: these emit the bytes \x1a / \x19,
    // which `useImmediateInput.parseInput` surfaces as `key.ctrl && input === 'z'|'y'`.
    if (key.ctrl && input === 'z') {
      handleUndo();
      return;
    }
    if (key.ctrl && input === 'y') {
      handleRedo();
      return;
    }
    if (key.ctrl && input === 'r') {
      setShowReloadDialog(true);
      return;
    }

    // T5 (parity plan §3): unsaved-changes warning owns keystrokes when open.
    // Enter → save + complete deferred focus cross.
    // Esc   → discard (revert FieldEditor draft) + complete deferred cross.
    // Tab   → cancel: close dialog, keep focus in the panel, leave the
    //         FieldEditor dirty. Anything else falls through to close-cancel.
    if (showUnsavedWarning) {
      if (key.return) {
        handleEditSave();
        setShowUnsavedWarning(false);
        if (pendingFocusAway === 'tab-to-sidebar') setSidebarFocused(true);
        setPendingFocusAway(null);
        return;
      }
      if (key.escape) {
        setDiscardTrigger((n) => n + 1);
        setShowUnsavedWarning(false);
        if (pendingFocusAway === 'tab-to-sidebar') setSidebarFocused(true);
        setPendingFocusAway(null);
        return;
      }
      // Tab (and any other input) cancels — keep the operator in the panel
      // with their pending edit intact.
      setShowUnsavedWarning(false);
      setPendingFocusAway(null);
      return;
    }

    // Fuzzy-search input mode owns most keystrokes while the input is open.
    // Mirrors ScopeGateStep's `/` UX: Esc closes + clears, Enter closes but
    // preserves the query (dim persists), Backspace deletes, printable chars
    // append.
    if (searchOpen) {
      if (key.escape) {
        setSearchOpen(false);
        setSearchQuery('');
        setAutocompleteCandidates([]);
        return;
      }
      if (key.return) {
        // T7b delta 3 — mirror ScopeGate: Enter with empty query OR zero
        // matches clears + closes so the user doesn't get stuck with a
        // dim-all state and no on-screen recovery besides Esc.
        setAutocompleteCandidates([]);
        if (!searchQuery || searchMatches.length === 0) {
          setSearchOpen(false);
          setSearchQuery('');
          return;
        }
        let jumped = false;
        // T7b delta 4 — scan STRICTLY AFTER the current cursor row so Enter
        // on a match advances to the next one (parity with ScopeGate).
        for (let i = cursorRowIdx + 1; i < visibleRowsMemo.length; i++) {
          const row = visibleRowsMemo[i];
          if (row.itemIdx < 0) continue;
          const key2 = components[row.itemIdx]?.key;
          if (key2 && fuzzyMatches(searchQuery, key2)) {
            jumpCursorToRow(i);
            jumped = true;
            break;
          }
        }
        if (!jumped) {
          // Wrap-around: no match strictly after cursor, jump to first match
          // anywhere in the list (searchMatches.length > 0 guaranteed above).
          jumpCursorToRow(searchMatches[0]);
        }
        setSearchOpen(false);
        return;
      }
      if (key.tab) {
        // L4: shell-style Tab autocomplete. Complete to the longest common
        // prefix of all prefix-matching component keys; when >1 candidate,
        // surface a possibilities strip. Prefix semantics (NOT fuzzy) — the
        // fuzzy `[n]` match-cycle is a separate, preserved path. No-op with no
        // candidates. Input stays open.
        const { completion, candidates } = computeAutocomplete(
          searchQuery,
          components.map((c) => c.key),
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

    // L6 (lifecycle plan §5 L6) — breaking-changes goto-banner owns keystrokes
    // when open. Mirrors the lineage panel: ↑/↓/j/k move the cursor, Enter
    // jumps the main selection to the highlighted breaking component + closes,
    // `[b]`/Esc close (via the shared hook).
    if (breakingPanel.isOpen) {
      if (breakingPanel.handleInput(input, key)) return;
      if (key.upArrow || input === 'k') {
        setBreakingCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setBreakingCursor((c) => Math.min(Math.max(0, breakingRows.length - 1), c + 1));
        return;
      }
      if (key.return) {
        // BD4 — jump the sidebar to the component AND focus the editor scrolled
        // to the exact changed field. `jumpCursorToName` clears any stale
        // pending focus, so set it AFTER the jump. `sidebarFocused=false` hands
        // the keyboard to the FieldEditor so it opens on the target field.
        const row = breakingRows[breakingCursor];
        if (row) {
          jumpCursorToName(row.componentName);
          if (row.focusTarget) {
            setPendingEditorFocus({ componentName: row.componentName, target: row.focusTarget });
            setSidebarFocused(false);
          }
        }
        breakingPanel.close();
        return;
      }
      return;
    }
    // T6 (parity plan §3) — lineage panel owns keystrokes when open.
    // Mirrors ScopeGate's overlay-owns-input pattern. Close-side (`[l]` toggle
    // and `[Esc]`) is delegated to the shared `useOverlayPanel` hook (T10);
    // ↑/↓/j/k move the panel cursor, Tab cycles, and Enter jumps main selection
    // to the highlighted jumpable and closes.
    if (lineagePanel.isOpen) {
      if (lineagePanel.handleInput(input, key)) return;
      if (key.upArrow || input === 'k') {
        setLineageCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setLineageCursor((c) => Math.min(Math.max(0, lineageJumpables.length - 1), c + 1));
        return;
      }
      if (key.tab) {
        setLineageCursor((c) =>
          lineageJumpables.length === 0 ? 0 : (c + 1) % lineageJumpables.length,
        );
        return;
      }
      if (key.return) {
        const target = lineageJumpables[lineageCursor];
        if (target && (target.entry.kind === 'ancestor' || target.entry.kind === 'descendant')) {
          jumpCursorToName(target.entry.jumpTarget);
        }
        lineagePanel.close();
        return;
      }
      return;
    }
    // A9 — the interactive break-cycle overlay owns input while open. It sits
    // ABOVE the cyclePanel handler because `[x]` opens it from within the `[c]`
    // list, so both are technically "open"; the break overlay takes priority.
    // Close-side (`[x]` toggle + Esc) is delegated to the shared hook.
    if (breakPanel.isOpen) {
      // While the confirm prompt is up, [y] deletes, [n]/Esc cancels — nothing
      // else moves the cursor or closes the overlay.
      if (breakConfirm) {
        if (input === 'y') {
          const edge = breakEdges[breakCursor];
          if (edge) handleBreakEdge(edge);
          setBreakConfirm(false);
          breakPanel.close();
          return;
        }
        if (input === 'n' || key.escape) {
          setBreakConfirm(false);
          return;
        }
        return;
      }
      if (breakPanel.handleInput(input, key)) return;
      // A2-4 — the overlay list spans TWO kinds of entries in one continuous
      // cursor range: slot-edge removals [0, breakEdges.length) followed by
      // reject-member entries [breakEdges.length, breakEdges.length +
      // breakMembers.length).
      const totalBreakEntries = breakEdges.length + breakMembers.length;
      if (key.upArrow || input === 'k') {
        setBreakCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setBreakCursor((c) => Math.min(Math.max(0, totalBreakEntries - 1), c + 1));
        return;
      }
      if (key.return) {
        if (breakCursor < breakEdges.length) {
          // Edge entry → arm the [y]/[n] confirm (unchanged behavior).
          if (breakEdges[breakCursor]) setBreakConfirm(true);
          return;
        }
        // A2-4 — reject-member entry → reject IMMEDIATELY (no confirm), matching
        // the sidebar `[r]` reject. The recompute drops the resolved cycle;
        // close the overlay afterward.
        const member = breakMembers[breakCursor - breakEdges.length];
        if (member) {
          handleRejectComponent(member);
          breakPanel.close();
        }
        return;
      }
      return;
    }
    // INTEG-4401: slot-cycle detail panel. Same modal-swallow rules as
    // removed panel; `[c]` / `[Esc]` close (via shared hook), `[q]` also closes
    // (legacy), ↑↓ scroll.
    if (cyclePanel.isOpen) {
      // A9 — `[x]` opens the break-cycle overlay for the highlighted cycle when
      // that cycle has at least one removable slot edge. The cycle list stays
      // open underneath; the break overlay renders on top + owns input.
      if (input === 'x' && (breakEdges.length > 0 || breakMembers.length > 0)) {
        breakPanel.open();
        setBreakCursor(0);
        setBreakConfirm(false);
        return;
      }
      if (cyclePanel.handleInput(input, key)) return;
      if (input === 'q') {
        cyclePanel.close();
        return;
      }
      // A8 — ↑/↓/j/k move the cycle cursor (mirrors SG's cyclesJumpables list);
      // Enter jumps the main sidebar cursor to the highlighted cycle's root.
      if (key.upArrow || input === 'k') {
        setCyclesCursor((c) => {
          const next = Math.max(0, c - 1);
          setCyclePanelScroll((scroll) => followCycleScroll(scroll, next, slotCycles, 20));
          return next;
        });
        return;
      }
      if (key.downArrow || input === 'j') {
        setCyclesCursor((c) => {
          const next = Math.min(Math.max(0, slotCycles.length - 1), c + 1);
          setCyclePanelScroll((scroll) => followCycleScroll(scroll, next, slotCycles, 20));
          return next;
        });
        return;
      }
      if (key.return) {
        const target = slotCycles[cyclesCursor];
        if (target && target.path.length > 0) jumpCursorToName(target.path[0]);
        cyclePanel.close();
        return;
      }
      return;
    }
    // Open the cycle panel from sidebar-focused state when there is at
    // least one cycle to display.
    if (input === 'c' && sidebarFocused && slotCycles.length > 0) {
      cyclePanel.open();
      setCyclePanelScroll(0);
      setCyclesCursor(0);
      return;
    }
    // T6 (parity plan §3) — `[l]` opens the lineage panel when the sidebar
    // has a component under the cursor. Gated to sidebar-focused so it can't
    // collide with FieldEditor input.
    if (input === 'l' && sidebarFocused && focusedComponentKey) {
      lineagePanel.open();
      setLineageCursor(0);
      return;
    }
    // L6 — `[b]` opens the breaking-changes goto-banner when the live preview
    // reported at least one breaking change. No-op otherwise (hint hidden).
    if (input === 'b' && sidebarFocused && breakingChanges.length > 0) {
      breakingPanel.open();
      setBreakingCursor(0);
      return;
    }
    // L8 — category filter toggles. `[o]` cycles, `[w]` broken. Sidebar-focused
    // so they can't collide with FieldEditor input. Independent toggles;
    // multiple active filters union in `filterVisibleKeys`. L11 removed the
    // `[d]` deleted filter — GR no longer offers it.
    // A2-2 — `[d]` toggles the removed-components banner detail rows. Sidebar-
    // focused so it can't collide with FieldEditor text entry. No-op when there
    // are no removed components (the banner isn't rendered anyway).
    if (input === 'd' && sidebarFocused && removedComponents.length > 0) {
      setRemovedBannerCollapsed((prev) => !prev);
      return;
    }
    if (sidebarFocused && (input === 'o' || input === 'w')) {
      const category: FilterCategory = input === 'o' ? 'cycles' : 'broken';
      setActiveFilters((prev) => {
        const next = new Set(prev);
        if (next.has(category)) next.delete(category);
        else next.add(category);
        return next;
      });
      return;
    }
    // T5b (layout plan §B) — jump-and-filter to focused component + all
    // transitive ancestors. Sidebar-focused only. Mirrors ScopeGateStep T5.
    // Guard against Ctrl-I aliasing: Tab is Ctrl+I (\x09), which
    // `parseInput` surfaces as `input='i'` with `key.tab=true, key.ctrl=true`.
    if (
      input === 'i' &&
      sidebarFocused &&
      !key.tab &&
      !key.ctrl &&
      !key.meta &&
      focusedComponentKey
    ) {
      const t = focusedComponentKey;
      setJumpFilterTarget((prev) => (prev === t ? null : t));
      return;
    }

    // Lifted rationale + source panels: i/I/s fire from anywhere (sidebar OR
    // panel focus). Gated against text-entry surfaces inside FieldEditor
    // (description editors, string-default editor, value-list text entry)
    // via the `onTextEntryActiveChange` callback, plus the help/finalize/quit
    // overlays and the JSON view.
    if (panelOpen !== 'none') {
      const PANEL_HEIGHT_LOCAL = 12;
      const next = computeNextScrollOffset(panelScrollOffset, input, key, 9999, PANEL_HEIGHT_LOCAL);
      if (next !== null) {
        setPanelScrollOffset(() => next);
        return;
      }
      if (key.escape) {
        setPanelOpen('none');
        setPanelScrollOffset(() => 0);
        return;
      }
      // Guard against Ctrl-letter aliases (Tab is Ctrl+I in ASCII, Ctrl+S would
      // collide with save in nested editors). Only react to bare keystrokes.
      const togglable = !key.ctrl && !key.tab && !key.meta && !key.return;
      if (togglable && input === 'p' && panelOpen === 'prop-rationale') {
        setPanelOpen('none');
        setPanelScrollOffset(() => 0);
        return;
      }
      if (togglable && input === 'P' && panelOpen === 'component-rationale') {
        setPanelOpen('none');
        setPanelScrollOffset(() => 0);
        return;
      }
      if (togglable && input === 's' && panelOpen === 'source') {
        setPanelOpen('none');
        setPanelScrollOffset(() => 0);
        return;
      }
      // Cross-panel toggles while one is open.
      if (togglable && input === 'p') {
        setPanelOpen('prop-rationale');
        setPanelScrollOffset(() => 0);
        return;
      }
      if (togglable && input === 'P') {
        setPanelOpen('component-rationale');
        setPanelScrollOffset(() => 0);
        return;
      }
      if (togglable && input === 's') {
        setPanelOpen('source');
        setPanelScrollOffset(() => 0);
        return;
      }
      return;
    }
    const rationaleKeyOk = !textEntryActive && !showJson && !key.ctrl && !key.tab && !key.meta && !key.return;
    if (rationaleKeyOk) {
      if (input === 'p') {
        setPanelOpen('prop-rationale');
        setPanelScrollOffset(() => 0);
        return;
      }
      if (input === 'P') {
        setPanelOpen('component-rationale');
        setPanelScrollOffset(() => 0);
        return;
      }
      if (input === 's') {
        setPanelOpen('source');
        setPanelScrollOffset(() => 0);
        return;
      }
    }

    // Tab toggles focus bidirectionally between sidebar and panel. `e` is a
    // sidebar-only alias for crossing INTO the panel — gating it to the
    // sidebar-focused state prevents collision with FieldEditor's enum-values
    // `e` binding (INTEG-4254) when the panel is focused. Crossing back from
    // panel to sidebar is Tab-only.
    if (key.tab) {
      // T5: intercept panel→sidebar Tab when the FieldEditor is dirty. Open
      // the warning dialog and remember the deferred action; Enter/Esc from
      // the dialog will complete it. Only fires when crossing OUT of the
      // panel — sidebar→panel Tab is not blocked because entering the panel
      // never risks losing edits.
      if (!sidebarFocused && editorDirty) {
        setPendingFocusAway('tab-to-sidebar');
        setShowUnsavedWarning(true);
        return;
      }
      // T3: match-cycling via Tab is retired — Tab now unconditionally
      // toggles focus. Match-cycling moved to [n] (see sidebar-focused
      // block below).
      setSidebarFocused((prev) => !prev);
      return;
    }
    if (input === ' ' && sidebarFocused && !showJson) {
      const current = components[selectedIdx];
      if (!current) return;
      const rootName = resolveGroupRoot(current.key, closures, cycleView.structural);
      if (!rootName) return;
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(rootName)) next.delete(rootName);
        else next.add(rootName);
        return next;
      });
      return;
    }

    // JSON view + panel focused: own j/k/arrows/PageUp/PageDown/Ctrl+u/d/gg/G
    // for scrolling. Computed against the live `selectedJson` so the
    // viewport math matches what JsonPanel renders.
    if (!sidebarFocused && showJson) {
      const current = components[selectedIdx];
      const currentJson = current ? JSON.stringify({ [current.key]: current.entry }, null, 2) : '';
      const totalLines = currentJson.split('\n').length;
      const maxOffset = Math.max(0, totalLines - PANEL_HEIGHT);

      // `gg` double-tap to jump to top; single `g` arms the pending flag.
      if (input === 'g' && !key.ctrl) {
        if (pendingGRef.current) {
          pendingGRef.current = false;
          setJsonScrollOffset(() => 0);
          return;
        }
        pendingGRef.current = true;
        return;
      }

      const next = computeNextScrollOffset(jsonScrollOffset, input, key, totalLines, PANEL_HEIGHT);
      if (next !== null) {
        pendingGRef.current = false;
        // Functional setState mirrors the cursor-stutter fix (commit 5d11e60).
        // Clamp against maxOffset re-computed at apply time in case totalLines
        // shifted between events (defensive — helper already clamps).
        const clamped = Math.min(maxOffset, Math.max(0, next));
        setJsonScrollOffset(() => clamped);
        return;
      }
      // Any other key in this slice resets the gg-pending flag, then falls
      // through to the early-return below so the panel-focused state still
      // swallows non-scroll input.
      pendingGRef.current = false;
    }

    // When the panel is focused, FieldEditor (or JsonPanel) owns the keys.
    // Only Tab (handled above) should escape from the panel-focused state.
    if (!sidebarFocused) return;

    // Sidebar-focused keymap.
    // Fuzzy-search openers/cycle. `/` opens input, Tab cycles matches at/after
    // cursor, Esc with an active query clears it. `/` is not currently bound
    // in this step so no collision.
    if (input === '/') {
      setSearchOpen(true);
      return;
    }
    // T3: [n] cycles matches when a query is active and search is closed.
    if (input === 'n' && searchQuery && searchMatches.length > 0) {
      let next: number | null = null;
      for (let i = cursorRowIdx + 1; i < visibleRowsMemo.length; i++) {
        const row = visibleRowsMemo[i];
        if (row.itemIdx < 0) continue;
        const key2 = components[row.itemIdx]?.key;
        if (key2 && fuzzyMatches(searchQuery, key2)) {
          next = i;
          break;
        }
      }
      if (next === null) next = searchMatches[0] ?? null;
      if (next !== null) jumpCursorToRow(next);
      return;
    }
    // T5b: Esc clears jump-filter first, then search-query (mirrors SG T5).
    if (key.escape && jumpFilterTarget) {
      setJumpFilterTarget(null);
      return;
    }
    if (key.escape && searchQuery) {
      setSearchQuery('');
      setAutocompleteCandidates([]);
      return;
    }
    if (input === '?') {
      setShowHelp(true);
      return;
    }
    if (input === 'q') {
      setShowQuit(true);
      return;
    }
    if (input === 'F' || input === 'f') {
      // Task #37 — partition-by-decisions gate. Reproduce scope-gate's
      // `[f]` contract: partition into { accepted, rejected } and refuse
      // to continue if the accepted subset still contains a slot cycle
      // (the strongest local approximation of task #39's slot validator).
      const acceptedNames = new Set(
        components.filter((c) => c.status === 'accepted').map((c) => c.key),
      );
      const acceptedSubgraph: ComponentGraphNode[] = componentGraph.filter((n) =>
        acceptedNames.has(n.name),
      );
      const acceptedCycles = (() => {
        try {
          return findSlotCycles(acceptedSubgraph);
        } catch {
          return [];
        }
      })();
      if (acceptedCycles.length > 0) {
        const participants = new Set<string>();
        for (const c of acceptedCycles) for (const p of c.path) participants.add(p);
        setFinalizeError(
          `Cannot finalize — accepted set still contains a cycle (${[...participants].sort().join(', ')}). Reject a cycle member to break it.`,
        );
        return;
      }
      setShowFinalize(true);
      return;
    }
    if (input === 'L') {
      // T8 (parity plan §3) — toggle Column-1 view between grouped and
      // flat. Preserve cursor on the same underlying component when
      // possible; otherwise fall back to the first selectable row. Mirrors
      // ScopeGateStep's `[L]` handler line-for-line so the two steps stay
      // pixel-consistent.
      const currentKey =
        cursorRowIdx >= 0 && cursorRowIdx < visibleRowsMemo.length
          ? components[visibleRowsMemo[cursorRowIdx]?.itemIdx ?? -1]?.key ?? null
          : null;
      const nextView: 'grouped' | 'flat' =
        columnOneView === 'grouped' ? 'flat' : 'grouped';
      const nextRows = buildVisibleRows({
        items: groupedItemsMemo,
        cycleParticipants: cycleView.structural,
        expandedGroups,
        viewMode: nextView,
        graph: sidebarGraph,
      });
      let nextCursor = 0;
      if (currentKey) {
        for (let i = 0; i < nextRows.length; i++) {
          const r = nextRows[i];
          if (r.itemIdx < 0) continue;
          if (components[r.itemIdx]?.key === currentKey) {
            nextCursor = i;
            break;
          }
        }
      }
      const nextScroll =
        nextCursor < sidebarScrollOffset
          ? nextCursor
          : nextCursor >= sidebarScrollOffset + visibleCount
            ? nextCursor - visibleCount + 1
            : sidebarScrollOffset;
      setColumnOneView(nextView);
      setNav({ cursorRowIdx: nextCursor, sidebarScrollOffset: nextScroll });
      return;
    }
    if (input === 'a') {
      // Task #37 — accept cascades DOWN to descendants (mirrors scope-gate).
      const current = components[selectedIdx];
      if (!current) return;
      const cascade = computeAcceptCascade(current.key, componentGraph);
      const next = components.map((c) =>
        cascade.has(c.key) ? { ...c, status: 'accepted' as ReviewComponentStatus } : c,
      );
      setComponents(next);
      setFinalizeError(null);
      recomputeCycles(next);
      pushHistorySnapshot(next, autoRejected, undoSnapshot, 'accept-cascade');
      return;
    }
    if (input === 'r') {
      // Task #37 reject cascade, now shared with the A2-4 break-overlay
      // "reject component" entries via `handleRejectComponent`.
      const current = components[selectedIdx];
      if (!current) return;
      handleRejectComponent(current.key);
      return;
    }
    if (input === 'A') {
      const next = components.map((c) =>
        c.status === 'needs-review' ? { ...c, status: 'accepted' as ReviewComponentStatus } : c,
      );
      setComponents(next);
      setFinalizeError(null);
      pushHistorySnapshot(next, autoRejected, undoSnapshot, 'bulk-accept');
      return;
    }
    if (input === 'E') {
      // Expand every group root — the set of "every group root" is any
      // closure whose node count is >1 (i.e., roots with ≥1 descendant).
      // T1 parity fix: cycle-tier rows also read `expandedGroups.has(root)`
      // (see GroupedSidebar cycle-tier render), so union every structural
      // cycle participant in so [E] expand-all covers both tiers.
      const roots = new Set<string>();
      for (const [name, closure] of closures.entries()) {
        if (closure.nodes.length > 1) roots.add(name);
      }
      for (const name of cycleView.structural) roots.add(name);
      setExpandedGroups(roots);
      return;
    }
    if (input === 'C') {
      setExpandedGroups(new Set());
      return;
    }
    if (input === 'J') {
      // Toggle read-only JSON view.
      setShowJson((prev) => !prev);
      setJsonScrollOffset(0);
      pendingGRef.current = false;
      return;
    }

    // Composite-components drill-to-source. When the selected sidebar row is
    // an ancestor showing an inherited-issue marker (isOwn: false), Enter
    // jumps selection to the descendant that actually owns the issue. Rows
    // that own their issue (isOwn: true) or have no marker are no-ops.
    if (key.return) {
      const current = components[selectedIdx];
      if (!current) return;
      const rs = renderStatusByKey.get(current.key);
      if (!rs || rs.isOwn) return;
      // Find the closure that contains this ancestor and drill within it.
      for (const closure of closures.values()) {
        if (!closure.nodes.some((n) => n.name === current.key)) continue;
        const target = pickDrillTarget(current.key, closure, directIssues);
        if (target && target !== current.key) {
          jumpCursorToName(target);
        }
        break;
      }
      return;
    }

    if (key.upArrow || input === 'k') {
      // INTEG-4411 duplicate-cursor fix: cursor moves through visible-row
      // positions (not item indices), so a shared dep occurring under
      // multiple parents visits each row on its own instead of collapsing
      // to a single stop. `selectableRowPositions` is the ordered list of
      // rows that map to a real component (skips flat-header separators).
      //
      // Pilot-2026-06-23 bug: rapid k/j bursts previously lost cursor
      // position because the handler read `selectedIdx` from its closure —
      // merging cursor + scrollOffset into one `setNav` updater keeps them
      // consistent AND avoids nested-setState re-renders per keystroke.
      setNav(({ cursorRowIdx: prev, sidebarScrollOffset: off }) => {
        const positions = selectableRowPositions;
        if (positions.length === 0) return { cursorRowIdx: prev, sidebarScrollOffset: off };
        const pos = positions.indexOf(prev);
        // If we're not on a selectable row (shouldn't happen, but defensive),
        // land on the nearest selectable row at or before the current row.
        const currentSelectableIdx = pos >= 0
          ? pos
          : Math.max(
              0,
              positions.reduce((acc, p, i) => (p <= prev ? i : acc), 0),
            );
        const nextSelectableIdx = Math.max(0, currentSelectableIdx - 1);
        const newRow = positions[nextSelectableIdx] ?? prev;
        return { cursorRowIdx: newRow, sidebarScrollOffset: Math.min(off, newRow) };
      });
      setJsonScrollOffset(0);
      setDraftValue('');
      setSaveError(null);
      setPendingEditorFocus(null);
    } else if (key.downArrow || input === 'j') {
      setNav(({ cursorRowIdx: prev, sidebarScrollOffset: off }) => {
        const positions = selectableRowPositions;
        if (positions.length === 0) return { cursorRowIdx: prev, sidebarScrollOffset: off };
        const pos = positions.indexOf(prev);
        const currentSelectableIdx = pos >= 0
          ? pos
          : Math.max(
              0,
              positions.reduce((acc, p, i) => (p <= prev ? i : acc), 0),
            );
        const nextSelectableIdx = Math.min(positions.length - 1, currentSelectableIdx + 1);
        const newRow = positions[nextSelectableIdx] ?? prev;
        const nextOff = newRow >= off + visibleCount ? newRow - visibleCount + 1 : off;
        return { cursorRowIdx: newRow, sidebarScrollOffset: nextOff };
      });
      setJsonScrollOffset(0);
      setDraftValue('');
      setSaveError(null);
      setPendingEditorFocus(null);
    }
  });

  if (loading) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text dimColor>Loading generated definitions...</Text>
      </Box>
    );
  }

  if (loadError) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text color="red">{loadError}</Text>
      </Box>
    );
  }

  if (showHelp) {
    return <HelpOverlay sections={HELP_SECTIONS} onClose={() => setShowHelp(false)} />;
  }

  // A9 — break-cycle overlay body. Shared between the in-panel render (tall
  // terminal, beside the sidebar) and the full-screen fallback (short terminal
  // — replaces the columns, mirroring the L2d + `?` help pattern).
  const renderBreakOverlay = (width?: number): React.ReactElement => {
    const highlightedCycle = slotCycles[cyclesCursor];
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} width={width}>
        <Text bold color="yellow">
          {`BREAK CYCLE ${cyclesCursor + 1} — remove a slot edge or reject a member`}
        </Text>
        {highlightedCycle &&
          (() => {
            const segs = formatCyclePathSegments(highlightedCycle);
            return (
              <Text>
                {'  '}
                {segs.map((seg, si) =>
                  seg.kind === 'slot' ? (
                    <Text key={si} color="cyan">
                      {seg.text}
                    </Text>
                  ) : seg.kind === 'arrow' ? (
                    <Text key={si} dimColor>
                      {seg.text}
                    </Text>
                  ) : (
                    <Text key={si} color="yellow">
                      {seg.text}
                    </Text>
                  ),
                )}
              </Text>
            );
          })()}
        <Text dimColor>
          {highlightedCycle
            ? 'Deleting an edge removes it from $allowedComponents (undo with Ctrl+Z).'
            : 'No cycle highlighted.'}
        </Text>
        <Text> </Text>
        {breakEdges.length > 0 && <Text dimColor>{'remove slot edge:'}</Text>}
        {breakEdges.map((edge, idx) => {
          const isCursor = idx === breakCursor;
          return (
            <Text key={`break-${idx}`} inverse={isCursor}>
              {`${isCursor ? '▶' : ' '} remove '${edge.toComponent}' from ${edge.fromComponent}.$slots.${edge.slotName}.$allowedComponents`}
            </Text>
          );
        })}
        {breakMembers.length > 0 && <Text dimColor>{'reject cycle member:'}</Text>}
        {breakMembers.map((member, idx) => {
          const isCursor = breakEdges.length + idx === breakCursor;
          return (
            <Text key={`member-${idx}`} inverse={isCursor}>
              {`${isCursor ? '▶' : ' '} reject component '${member}'`}
            </Text>
          );
        })}
        {breakConfirm ? (
          <>
            <Text> </Text>
            <Text bold color="yellow">
              {'Delete this slot edge? [y] confirm  [n] cancel'}
            </Text>
          </>
        ) : (
          <Text dimColor>{'[↑↓/j/k] move  [Enter] delete/reject  [x/Esc] close'}</Text>
        )}
      </Box>
    );
  };
  const breakOverlayFullScreen =
    breakPanel.isOpen &&
    shouldBreakOverlayGoFullScreen({
      rows: stdout?.rows ?? FALLBACK_ROWS,
      edgeCount: breakEdges.length + breakMembers.length,
    });
  if (breakOverlayFullScreen) {
    return renderBreakOverlay();
  }

  const selected = components[selectedIdx] ?? null;
  const selectedJson = selected ? JSON.stringify({ [selected.key]: selected.entry }, null, 2) : '';

  const isEmpty = (c: CdfReviewEntry): boolean =>
    Object.keys(c.entry.$properties).length === 0 && Object.keys(c.entry.$slots ?? {}).length === 0;
  const emptyCount = components.filter(isEmpty).length;

  // INTEG-4401: cycle-participant set drives sidebar `(cycle)` badges. Reads
  // from the reified `cycleView.structural` so members whose ancestor is
  // rejected still get badged (matches the ADR-0010 §C.1 unfiltered arm).
  const cycleParticipantSet = cycleView.structural;

  const sidebarSuffix = (c: CdfReviewEntry): string => {
    if (cycleParticipantSet.has(c.key)) return ' (cycle)';
    if (isEmpty(c)) return ' (empty)';
    return '';
  };

  const groupedItems = groupedItemsMemo;

  const previewAnnotationByKey = previewAnnotations;

  // Account for the "(cycle)" / "(empty)" suffix and the grouped-sidebar
  // "(N deps)" / expand-arrow overhead so the sidebar doesn't truncate
  // aggregate glyphs or dep counts. Widest possible row per name:
  //   `▸ Name (NN deps) ✗` → keylen + 12
  //   `Name (empty|cycle)` → keylen + suffixlen
  const longestName = components.reduce((m, c) => {
    const suffixLen = sidebarSuffix(c).length;
    const groupOverhead = 12; // "▸  (99 deps) ✗"
    return Math.max(m, c.key.length + Math.max(suffixLen, groupOverhead));
  }, 0);
  // +9 = border (1) + selection glyph column "[✓] " (4) + badge column (1) +
  // leading space (1) + trailing pad (1) + border (1). Both reserved columns
  // stay fixed-width so the sidebar doesn't jitter as live-preview annotations
  // or selection state flip.
  //
  // INTEG-4412: cap by terminal-width-aware upper bound so long/nested composite
  // names aren't truncated at the old fixed 34-col ceiling.
  const sidebarWidthCap = computeSidebarWidth(terminalWidth);
  const sidebarWidth = Math.min(Math.max(longestName + 9, 18), sidebarWidthCap);
  const panelWidth = Math.max(10, terminalWidth - sidebarWidth - 4);

  // INTEG-4401: project-wide slot graph passed to FieldEditor so its
  // $allowedComponents picker can filter out cycle-forming candidates. Built
  // from every review entry's $slots — includes accepted, rejected, and
  // needs-review components so the graph reflects what will actually be
  // pushed. The FieldEditor replaces its own entry in-simulation with its
  // live editor state, so pending edits are always reflected.
  const projectSlotGraph = components.map((c) => ({
    name: c.key,
    slots: Object.entries(c.entry.$slots ?? {}).map(([slotName, slotDef]) => ({
      name: slotName,
      allowedComponents: Array.isArray(slotDef?.$allowedComponents)
        ? (slotDef.$allowedComponents as string[]).filter((v): v is string => typeof v === 'string')
        : [],
    })),
  }));

  // Legend gates: only advertise [Space]/[E]/[C] when at least one closure
  // has actual dependents (nodes.length > 1). `closures.size > 0` is true
  // even when every component is a standalone, which made the legend lie
  // about expand/collapse being useful. Tightening to real group roots means
  // operators with grouped manifests see the affordance and operators with
  // flat manifests don't chase a no-op key.
  const hasGroupRoots = (() => {
    for (const c of closures.values()) if (c.nodes.length > 1) return true;
    return false;
  })();

  const accepted = components.filter((c) => c.status === 'accepted').length;
  const rejected = components.filter((c) => c.status === 'rejected').length;
  const needsReview = components.filter((c) => c.status === 'needs-review').length;
  const propCount = selected ? Object.keys(selected.entry.$properties).length : 0;
  const slotCount = selected?.entry.$slots ? Object.keys(selected.entry.$slots).length : 0;

  return (
    <Box flexDirection="column">
      {showFinalize && (
        <FinalizeDialog
          accepted={accepted}
          rejected={rejected}
          needsReview={needsReview}
          onConfirm={handleFinalizeConfirm}
          onCancel={() => setShowFinalize(false)}
        />
      )}
      {showQuit && <QuitDialog hasUnsavedDrafts={false} onConfirm={onQuit} onCancel={() => setShowQuit(false)} />}
      {showUnsavedWarning && !dialogOpen && (
        // T5 (parity plan §3): inline warning shown when the operator tries
        // to leave a dirty FieldEditor via Tab. Enter saves, Esc discards,
        // Tab cancels (keystrokes handled in the useImmediateInput block).
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text bold color="yellow">Unsaved changes</Text>
          <Text>You have unsaved edits in the current field editor.</Text>
          <Text> </Text>
          <Text>{'  [Enter]  Save and continue'}</Text>
          <Text>{'  [Esc]    Discard changes and continue'}</Text>
          <Text>{'  [Tab]    Stay in the panel'}</Text>
        </Box>
      )}
      {showReloadDialog && !dialogOpen && (
        // T4 (parity plan §3): inline confirm dialog for Ctrl+R reload-from-
        // save. Kept inline (mirrors T5 UnsavedChangesDialog shape) to stay
        // under the ~15-line threshold that would justify extraction.
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text bold color="yellow">Reload from saved state?</Text>
          <Text>Unsaved in-memory changes will be lost.</Text>
          <Text> </Text>
          <Text>{'  [Enter]  Confirm'}</Text>
          <Text>{'  [Esc]    Cancel'}</Text>
        </Box>
      )}
      {removedComponents.length > 0 && !dialogOpen && (
        // T1 (layout plan §A) — permanent top strip. Renders unconditionally
        // above the auto-reject banner + cycle strips whenever the live
        // preview reports at least one removed component. When empty, this
        // block renders NOTHING (no placeholder, no push-down of layout).
        <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
          <Text bold color="red">
            {`Removed components (${removedComponents.length}) — will be `}
            <Text bold color="red">DELETE</Text>
            {'D from target space  (press [d] to expand/collapse)'}
          </Text>
          {!removedBannerCollapsed && (
            <>
              <Text> </Text>
              {removedComponents.map((rc) => (
                <Text key={rc.id}>{`- ${rc.name}${rc.id ? `  (${rc.id})` : ''}`}</Text>
              ))}
            </>
          )}
        </Box>
      )}
      {breakingChanges.length > 0 && !dialogOpen && (
        // L6 — key hint to open the breaking-changes goto-banner. Rendered
        // alongside the removed strip; L11 will regroup the copy.
        <Box paddingX={1}>
          <Text color="yellow">{`[b] ${breakingChanges.length} breaking change${breakingChanges.length === 1 ? '' : 's'}`}</Text>
        </Box>
      )}
      {cyclePanel.isOpen &&
        !dialogOpen &&
        (() => {
          // Materialize the full panel body as a flat list of Text lines,
          // then slice by cyclePanelScroll so ↑↓ can walk arbitrarily long
          // content. Each cycle contributes 3-4 lines: heading, path,
          // suggested fix (if any), and a blank separator.
          const PANEL_H = 20;
          const lines: React.ReactElement[] = [];
          lines.push(
            <Text key="cyc-title" bold color="yellow">
              {`SLOT DEPENDENCY CYCLES (${slotCycles.length})`}
            </Text>,
          );
          lines.push(
            <Text key="cyc-sub" dimColor>
              {'push will fail until these are resolved'}
            </Text>,
          );
          // A7 — state BOTH resolution paths so the operator knows rejection is
          // not the only option. (The interactive break-a-slot overlay is A9;
          // here we only mention it as a valid resolution.)
          lines.push(
            <Text key="cyc-guide" dimColor>
              {'To fix: reject a cycle member, or break the cycle by removing a slot edge.'}
            </Text>,
          );
          lines.push(<Text key="cyc-space"> </Text>);
          slotCycles.forEach((cycle, idx) => {
            const nodeCount = new Set(cycle.path).size;
            const isCursor = idx === cyclesCursor;
            lines.push(
              <Text
                key={`cyc-h-${idx}`}
                bold
                inverse={isCursor}
              >{`${isCursor ? '▶' : ' '} Cycle ${idx + 1} (${nodeCount} component${nodeCount === 1 ? '' : 's'}):`}</Text>,
            );
            // Colorize slots (cyan, bracketed) distinctly from components so
            // the operator can visually parse the alternating structure.
            // Brackets on slot names ensure the distinction survives when
            // ANSI is stripped (logs, redirected output).
            const segs = formatCyclePathSegments(cycle, 16);
            lines.push(
              <Text key={`cyc-p-${idx}`}>
                {'    '}
                {segs.map((seg, si) =>
                  seg.kind === 'slot' ? (
                    <Text key={si} color="cyan">
                      {seg.text}
                    </Text>
                  ) : seg.kind === 'arrow' ? (
                    <Text key={si} dimColor>
                      {seg.text}
                    </Text>
                  ) : (
                    <Text key={si}>{seg.text}</Text>
                  ),
                )}
              </Text>,
            );
            if (cycle.suggestedBreak) {
              const b = cycle.suggestedBreak;
              lines.push(
                <Text key={`cyc-f-${idx}`} dimColor>
                  {`    Suggested fix: remove '${b.toComponent}' from ${b.fromComponent}.$slots.${b.slotName}.$allowedComponents`}
                </Text>,
              );
            }
            lines.push(<Text key={`cyc-s-${idx}`}> </Text>);
          });
          const visible = lines.slice(cyclePanelScroll, cyclePanelScroll + PANEL_H);
          return (
            <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
              {visible}
              <Text dimColor>{'[↑↓/j/k] move  [Enter] jump  [x] break cycle  [c/q/Esc] close'}</Text>
            </Box>
          );
        })()}
      {!dialogOpen &&
        livePreview &&
        (() => {
          // Pilot-2026-06-23 R2: at-a-glance diff summary at the top of the
          // step. Mutually exclusive states:
          //   - hook running (and we don't yet have annotations) → spinner.
          //   - hook disabled (creds rejected) → static disabled hint.
          //   - annotations populated → counts.
          //   - idle, no annotations, not disabled → render nothing.
          const counts = { new: 0, changed: 0, removed: 0, breaking: 0 };
          for (const v of previewAnnotations.values()) {
            counts[v] = (counts[v] ?? 0) + 1;
          }
          const hasCounts = counts.new + counts.changed + counts.removed + counts.breaking > 0;
          if (livePreviewHook.disabled) {
            return <Text dimColor>{'Preview: disabled (creds rejected)'}</Text>;
          }
          if (livePreviewHook.status === 'running' && !hasCounts) {
            return <Text dimColor>{`Preview: ${livePreviewSpinner} running...`}</Text>;
          }
          if (!hasCounts) return null;
          return (
            <Box>
              <Text>{'Preview: '}</Text>
              <Text color="green">{`${counts.new} new`}</Text>
              <Text>{' · '}</Text>
              <Text color="yellow">{`${counts.changed} changed`}</Text>
              <Text>{' · '}</Text>
              <Text dimColor>{`${counts.removed} removed`}</Text>
              <Text>{' · '}</Text>
              <Text color="red" bold>
                {`${counts.breaking} breaking`}
              </Text>
            </Box>
          );
        })()}
      {!dialogOpen &&
        autoRejected.length > 0 &&
        (() => {
          // Task #37 — mount-time auto-reject banner. Only render when at
          // least one of the auto-rejected components is still `rejected`
          // in the current state — an operator who re-toggled a member to
          // `accepted` no longer needs the banner.
          const stillRejected = autoRejected.filter((name) => {
            const c = components.find((x) => x.key === name);
            return c?.status === 'rejected';
          });
          if (stillRejected.length === 0) return null;
          const participantSet = cycleView.structural;
          const members = stillRejected.filter((n) => participantSet.has(n)).sort();
          const ancestors = stillRejected.filter((n) => !participantSet.has(n)).sort();
          return (
            <Box flexDirection="column" borderStyle="single" borderColor="red" paddingX={1}>
              <Text color="red" bold>
                {`Cyclic manifest — auto-rejected ${stillRejected.length} component${stillRejected.length === 1 ? '' : 's'}:`}
              </Text>
              {members.length > 0 && (
                <Text color="red">{`  Cycle members: ${members.join(', ')}`}</Text>
              )}
              {ancestors.length > 0 && (
                <Text color="red">{`  Ancestors: ${ancestors.join(', ')}`}</Text>
              )}
              <Text dimColor>
                {undoSnapshot
                  ? '  [Ctrl+Z] undo · [r]/[a] manually toggle · [F] continue'
                  : '  [r]/[a] manually toggle · [F] continue'}
              </Text>
            </Box>
          );
        })()}
      {!dialogOpen && emptyCount > 0 && (
        <Text color="yellow">
          {`⚠ ${emptyCount} component${emptyCount === 1 ? '' : 's'} had no classifiable props — review with care`}
        </Text>
      )}
      {!dialogOpen && finalizeError && <Text color="red">{`⚠ ${finalizeError}`}</Text>}
      {/* T2 (layout plan §A): cycle banner + search input strips render BELOW
          the sidebar+detail row (they used to be here, above). Located in a
          fragment right after the sidebar Box. */}
      {!dialogOpen && (
        <Box>
          {breakingPanel.isOpen ? (
            // L6 — rendered IN the sidebar slot (like the lineage panel post-
            // L2d) so opening it does not grow the total frame height and
            // trigger Ink's full-screen repaint flicker.
            <GotoBanner
              title="Breaking changes"
              rows={breakingRows.map((r) => ({
                label: r.label,
                jumpTarget: r.componentName,
              }))}
              cursor={breakingCursor}
              maxRows={panelMaxRows}
              width={sidebarWidth}
              footerHint="[↑/↓] move · [Enter] jump · [Esc] close"
            />
          ) : lineagePanel.isOpen && focusedComponentKey ? (
            <LineagePanel
              focusedComponentKey={focusedComponentKey}
              entries={lineageEntries}
              cursor={lineageCursor}
              jumpables={lineageJumpables}
              maxRows={panelMaxRows}
              width={sidebarWidth}
            />
          ) : (
            <GroupedSidebar
              items={groupedItems}
              cycleParticipants={cycleParticipantSet}
              selectedIdx={selectedIdx}
              selectedRowIdx={cursorRowIdx}
              onSelect={(idx) => {
                // Jump to the FIRST visible row for the target itemIdx.
                for (let i = 0; i < visibleRowsMemo.length; i++) {
                  if (visibleRowsMemo[i].itemIdx === idx) {
                    jumpCursorToRow(i);
                    return;
                  }
                }
                setJsonScrollOffset(0);
              }}
              expandedGroups={expandedGroups}
              onToggleExpanded={(rootName) => {
                setExpandedGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(rootName)) next.delete(rootName);
                  else next.add(rootName);
                  return next;
                });
              }}
              width={sidebarWidth}
              focused={sidebarFocused}
              renderStatusByKey={renderStatusByKey}
              previewAnnotationByKey={previewAnnotationByKey}
              selectionStateByKey={selectionStateByKey}
              scrollOffset={sidebarScrollOffset}
              visibleCount={visibleCount}
              dimPredicate={dimPredicate}
              visibleRows={visibleRowsMemo}
              viewMode={columnOneView}
              graph={sidebarGraph}
            />
          )}
          <Box flexGrow={1} paddingLeft={1} flexDirection="column">
            {selected ? (
              <>
                <Box>
                  <Text bold>{selected.key}</Text>
                  <Box flexGrow={1} />
                  <Text dimColor>
                    {propCount} prop{propCount !== 1 ? 's' : ''}
                    {slotCount > 0 ? ` · ${slotCount} slot${slotCount !== 1 ? 's' : ''}` : ''}
                    {'  '}
                    {sidebarFocused ? '[Tab] focus panel' : '[Tab] focus list'}
                  </Text>
                </Box>
                {panelOpen === 'prop-rationale' ? (
                  (() => {
                    const rows: RationaleRow[] = [
                      ...(componentRationale?.props ?? []).map<RationaleRow>((p) => ({
                        name: p.name,
                        kind: 'prop',
                        rationale: p.rationale ?? '',
                      })),
                      ...(componentRationale?.slots ?? []).map<RationaleRow>((s) => ({
                        name: s.name,
                        kind: 'slot',
                        rationale: s.rationale ?? '',
                      })),
                    ];
                    return (
                      <RationalePanel
                        componentName={componentRationale?.name ?? selected.key}
                        rows={rows}
                        scrollOffset={panelScrollOffset}
                        width={panelWidth}
                        height={PANEL_HEIGHT}
                        active={true}
                      />
                    );
                  })()
                ) : panelOpen === 'component-rationale' ? (
                  <ComponentRationalePanel
                    data={
                      componentRationale ?? {
                        name: selected.key,
                        description: null,
                        descriptionRationale: null,
                        propsRationale: null,
                        slotsRationale: null,
                        props: [],
                        slots: [],
                      }
                    }
                    scrollOffset={panelScrollOffset}
                    width={panelWidth}
                    height={PANEL_HEIGHT}
                    active={true}
                  />
                ) : panelOpen === 'source' ? (
                  (() => {
                    const path = reviewMetadata?.sourcePath ?? null;
                    const src = reviewMetadata?.componentSource ?? null;
                    const headerPath = path ?? '<unknown source path>';
                    const lines = src ? src.split('\n').slice(panelScrollOffset, panelScrollOffset + PANEL_HEIGHT) : [];
                    return (
                      <Box
                        flexDirection="column"
                        width={panelWidth}
                        borderStyle="single"
                        borderColor="gray"
                        paddingX={1}
                      >
                        <Text dimColor bold>{`source: ${headerPath}`}</Text>
                        {src ? (
                          lines.map((ln, i) => (
                            <Text key={`source-line-${i}`} dimColor>
                              {ln}
                            </Text>
                          ))
                        ) : (
                          <Text dimColor>{'(no source captured)'}</Text>
                        )}
                        <Text dimColor>{'[s/Esc] close'}</Text>
                      </Box>
                    );
                  })()
                ) : showJson ? (
                  <JsonPanel
                    label="GENERATED DEFINITION (read-only)"
                    value={selectedJson}
                    scrollOffset={jsonScrollOffset}
                    width={panelWidth}
                    height={PANEL_HEIGHT}
                    active={!sidebarFocused}
                  />
                ) : (
                  <FieldEditor
                    key={
                      // BD4 — fold the pending focus target into the mount key so
                      // a jump to a breaking-change field on the ALREADY-selected
                      // component still remounts the editor onto that field (the
                      // initialFocusTarget seam is mount-time only). Clearing the
                      // pending focus on navigation returns the key to the bare
                      // component name (default first-field mount).
                      pendingEditorFocus && pendingEditorFocus.componentName === selected.key
                        ? `${selected.key}::${pendingEditorFocus.target.kind}:${pendingEditorFocus.target.name}`
                        : selected.key
                    }
                    value={draftValue || selectedJson}
                    width={panelWidth}
                    height={PANEL_HEIGHT}
                    active={!sidebarFocused}
                    onChange={setDraftValue}
                    onSave={handleEditSave}
                    onDiscard={handleEditDiscard}
                    onExit={() => setSidebarFocused(true)}
                    metadata={
                      reviewMetadata
                        ? ({
                            sourcePath: reviewMetadata.sourcePath,
                            componentSource: reviewMetadata.componentSource,
                            props: reviewMetadata.props,
                          } as FieldEditorMetadata)
                        : undefined
                    }
                    onTogglePropRationale={() => {
                      setPanelOpen('prop-rationale');
                      setPanelScrollOffset(() => 0);
                    }}
                    propRationaleKey="p"
                    componentRationaleKey="P"
                    onToggleComponentRationale={() => {
                      setPanelOpen('component-rationale');
                      setPanelScrollOffset(() => 0);
                    }}
                    onToggleSourceExternal={() => {
                      setPanelOpen('source');
                      setPanelScrollOffset(() => 0);
                    }}
                    onTextEntryActiveChange={setTextEntryActive}
                    projectSlotGraph={projectSlotGraph}
                    currentComponentName={selected.key}
                    onDirtyChange={setEditorDirty}
                    discardTrigger={discardTrigger}
                    initialFocusTarget={
                      pendingEditorFocus && pendingEditorFocus.componentName === selected.key
                        ? pendingEditorFocus.target
                        : undefined
                    }
                  />
                )}
                {saveError && <Text color="red">{'✗ ' + saveError}</Text>}
                <Text dimColor>
                  {sidebarFocused
                    ? // L11 — the complete sidebar keymap now lives in the
                      // single wrapping legend region below (built from atomic
                      // legendEntry nodes so keys never wrap away from labels
                      // and active toggles highlight). This inline line only
                      // carries context that depends on the selected component
                      // + the group-expand affordances.
                      (hasGroupRoots ? '  [Space] expand/collapse group  [E/C] expand/collapse all' : '')
                    : showJson
                      ? '  [j/k] scroll  [Ctrl+u/d] half-page  [gg/G] top/bottom  [Tab] focus list'
                      : '  [Tab] focus list  (edit fields)'}
                  {livePreviewHook.status === 'running' && <Text>{`  ${livePreviewSpinner} live preview`}</Text>}
                  {livePreviewHook.disabled && <Text>{'  · live preview disabled'}</Text>}
                </Text>
              </>
            ) : (
              <Text dimColor>No component selected</Text>
            )}
          </Box>
        </Box>
      )}
      {breakPanel.isOpen && !breakOverlayFullScreen && !dialogOpen && renderBreakOverlay()}
      {!dialogOpen && slotCycles.length > 0 && !cyclePanel.isOpen && !breakPanel.isOpen && (
        <Box flexDirection="column">
          <Text color="yellow">
            {`⚠ ${slotCycles.length} slot dependency cycle${slotCycles.length === 1 ? '' : 's'} detected — push will fail`}
          </Text>
          {slotCycles.slice(0, 3).map((cycle, idx) => {
            const segs = formatCyclePathSegments(cycle);
            return (
              <Text key={`cyc-banner-${idx}`} color="yellow">
                {'  Cycle: '}
                {segs.map((seg, si) =>
                  seg.kind === 'slot' ? (
                    <Text key={si} color="cyan">
                      {seg.text}
                    </Text>
                  ) : seg.kind === 'arrow' ? (
                    <Text key={si} dimColor>
                      {seg.text}
                    </Text>
                  ) : (
                    <Text key={si} color="yellow">
                      {seg.text}
                    </Text>
                  ),
                )}
              </Text>
            );
          })}
          {slotCycles.length > 3 && <Text color="yellow">{`  …${slotCycles.length - 3} more`}</Text>}
          <Text dimColor>{'  press [c] for detail'}</Text>
        </Box>
      )}
      {!dialogOpen && searchOpen && (
        <Box flexDirection="column">
          <Text>
            {`/${searchQuery}`}
            <Text color="cyan">{'▎'}</Text>
            {searchQuery && (
              <Text dimColor>{`  (${searchMatchCount}/${components.length} matches)`}</Text>
            )}
          </Text>
          {autocompleteCandidates.length > 1 && (
            <Text dimColor>
              {`  possibilities: ${autocompleteCandidates.join(' · ').slice(0, 120)}`}
            </Text>
          )}
        </Box>
      )}
      {!dialogOpen && !searchOpen && searchQuery && (
        <Box>
          <Text dimColor>{`/${searchQuery}  (${searchMatchCount}/${components.length} matches) · [Esc] clear · [n] next`}</Text>
        </Box>
      )}
      {!dialogOpen && sidebarFocused && (
        // L11 — complete bottom legend for the sidebar-focused state. One
        // wrapping region of atomic legendEntry nodes so a key never wraps
        // away from its label (item 7) and toggle/mode keys highlight when
        // active (item 1). Kept to a single wrapping Box per the L2d
        // frame-height caution (no stacked always-on rows). Distinct cycle
        // labels: [c] "cycle list" (panel) vs [o] "only cycles" (filter).
        <Box columnGap={2} flexWrap="wrap">
          {legendEntry('[j/k]', 'move')}
          {legendEntry('[a]', 'accept')}
          {legendEntry('[r]', 'reject')}
          {legendEntry('[A]', 'accept all')}
          {legendEntry('[F]', 'finalize')}
          {legendEntry('[L]', 'flat', columnOneView === 'flat')}
          {legendEntry('[l]', 'lineage', lineagePanel.isOpen)}
          {legendEntry('[i]', 'focus lineage', jumpFilterTarget !== null)}
          {legendEntry('[w]', 'see breaking changes', activeFilters.has('broken'))}
          {slotCycles.length > 0 && legendEntry('[o]', 'only cycles', activeFilters.has('cycles'))}
          {slotCycles.length > 0 && legendEntry('[c]', 'cycle list', cyclePanel.isOpen)}
          {legendEntry('[p]', 'prop rationale', panelOpen === 'prop-rationale')}
          {legendEntry('[P]', 'component rationale', panelOpen === 'component-rationale')}
          {legendEntry('[s]', 'source', panelOpen === 'source')}
          {legendEntry('[J]', showJson ? 'hide JSON' : 'show JSON', showJson)}
          {breakingChanges.length > 0 && legendEntry('[b]', 'breaking', breakingPanel.isOpen)}
          {removedComponents.length > 0 &&
            legendEntry('[d]', removedBannerCollapsed ? 'show removed' : 'hide removed', !removedBannerCollapsed)}
          {legendEntry('[/]', 'search', searchOpen || searchQuery.length > 0)}
          {legendEntry('[Tab]', 'focus panel')}
          {legendEntry('[Ctrl+Z]', 'undo')}
          {legendEntry('[Ctrl+Y]', 'redo')}
          {legendEntry('[Ctrl+R]', 'reload')}
          {legendEntry('[?]', 'help')}
          {legendEntry('[q]', 'quit')}
        </Box>
      )}
      {!dialogOpen && (
        <StatusBar
          accepted={accepted}
          rejected={rejected}
          reviewed={0}
          needsReview={needsReview}
          onApproveAll={() => {
            setComponents((prev) => prev.map((c) => (c.status === 'needs-review' ? { ...c, status: 'accepted' } : c)));
          }}
          onFinalize={() => setShowFinalize(true)}
        />
      )}
    </Box>
  );
}

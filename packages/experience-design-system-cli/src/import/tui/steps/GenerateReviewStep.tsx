import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { getReviewJsonPanelValue } from './review-json-panel.js';
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
import { StatusBar } from '../../../analyze/select/tui/components/StatusBar.js';
import { FinalizeDialog } from '../../../analyze/select/tui/components/FinalizeDialog.js';
import {
  removedComponentsHeader,
  removedComponentLine,
} from '../../../analyze/select/tui/components/removed-components-text.js';
import { QuitDialog } from '../../../analyze/select/tui/components/QuitDialog.js';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';
import {
  openPipelineDb,
  storeCDFComponents,
  storeSlotCycles,
  loadSlotCycles,
  type StoredSlotCycle,
} from '../../../session/db.js';
import { formatCyclePathSegments, findSlotCycles, suggestCycleBreakEdge } from '../../../analyze/cycle-detection.js';
import { followCycleScroll } from '../cycle-panel-scroll.js';
import type { ReviewComponentStatus } from '../../../analyze/select/types.js';
import { useReviewFinalizePreview } from '../useFinalizePreview.js';
import { fuzzyMatches } from '../../../analyze/fuzzy-search.js';
import {
  computeDirectNeighborhood,
  findAllAncestors as findAllAncestorsInclusive,
} from '../../../analyze/search-neighborhood.js';
import { computeSidebarWidth } from '../sidebar-width.js';
import { computeAcceptCascade, computeRejectCascade } from '../../../analyze/selection-cascade.js';
import { useLineage } from '../hooks/useLineage.js';
import { computeCycleAutoRejectTargets } from '../../cycle-auto-reject.js';
import { useOverlayPanel } from '../hooks/useOverlayPanel.js';
import { LineagePanel } from '../../../analyze/select/tui/components/LineagePanel.js';
import { GotoBanner } from '../../../analyze/select/tui/components/GotoBanner.js';
import { computeSidebarBudget, FALLBACK_ROWS } from '../lineage-layout.js';
import { HelpOverlay, type HelpSection } from '../../../analyze/select/tui/components/HelpOverlay.js';
import { legendEntry } from '../components/LegendEntry.js';
import { computeAutoRejectDecision } from './auto-reject-decision.js';
import { formatBreakingChange } from './breaking-change-format.js';
import { enumerateCycleBreaks, shouldBreakOverlayGoFullScreen, type BreakEdge } from './enumerate-cycle-breaks.js';
import type { HistorySnapshot } from '../history.js';
import { resolveGroupRoot } from '../group-collapse.js';
import { buildFlatDimPredicate, computeFilterKeys, intersectFilterKeys, type FilterCategory } from '../step-filters.js';
import { createSidebarViewsHelpSection } from '../sidebar-help.js';
import { handleSidebarSearchInput } from '../sidebar-input.js';
import { collectExpandedGroupRoots, computeSidebarViewToggle } from '../sidebar-navigation.js';
import { handleLineageNavigation } from '../lineage-input.js';
import { useSidebarSearchState } from '../hooks/sidebar-search-state.js';
import { SearchMatchSummary } from '../components/SearchMatchSummary.js';
import type { ReviewStepProps } from '../review-step-props.js';
import { ReviewDetailsEditor } from '../components/ReviewDetailsEditor.js';
import { countReviewStatuses, ReviewLoadError, ReviewLoadingState } from '../components/ReviewStatus.js';
import {
  createReviewHistorySnapshot,
  finalizeReviewSession,
  loadReviewSessionState,
  useReviewHistory,
  useReviewMetadata,
  useReviewSession,
  type CdfReviewEntry,
  type ReviewSessionLoadResult,
} from '../hooks/useReviewSession.js';
import { useReviewEditor } from '../hooks/useReviewEditor.js';
import { useReviewSurfaceState } from '../hooks/useReviewSurfaceState.js';
import {
  handleJsonPanelInput,
  handleReviewPanelShortcuts,
  handleReviewOverlayInput,
  handleReviewViewToggleInput,
} from '../hooks/review-input.js';
import { useReviewPreview } from '../hooks/useReviewPreview.js';
import { LivePreviewSummary } from '../components/LivePreviewSummary.js';

type GenerateReviewStepProps = ReviewStepProps;

export function sortComponentsForSidebar<T extends { key: string; entry: CDFComponentEntry }>(
  components: T[],
  cycleParticipants?: Set<string>,
): T[] {
  const isEmpty = (entry: CDFComponentEntry): boolean =>
    Object.keys(entry.$properties ?? {}).length === 0 && Object.keys(entry.$slots ?? {}).length === 0;
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

type CursorMoveDirection = 'up' | 'down';

function moveSelectableCursor({
  direction,
  previousRow,
  previousScroll,
  positions,
  visibleCount,
}: {
  direction: CursorMoveDirection;
  previousRow: number;
  previousScroll: number;
  positions: number[];
  visibleCount: number;
}): { cursorRowIdx: number; sidebarScrollOffset: number } {
  if (positions.length === 0) {
    return { cursorRowIdx: previousRow, sidebarScrollOffset: previousScroll };
  }

  const position = positions.indexOf(previousRow);
  const currentSelectableIdx =
    position >= 0
      ? position
      : Math.max(
          0,
          positions.reduce((acc, row, index) => (row <= previousRow ? index : acc), 0),
        );
  const nextSelectableIdx =
    direction === 'up'
      ? Math.max(0, currentSelectableIdx - 1)
      : Math.min(positions.length - 1, currentSelectableIdx + 1);
  const nextRow = positions[nextSelectableIdx] ?? previousRow;
  const nextScroll =
    direction === 'up'
      ? Math.min(previousScroll, nextRow)
      : nextRow >= previousScroll + visibleCount
        ? nextRow - visibleCount + 1
        : previousScroll;

  return { cursorRowIdx: nextRow, sidebarScrollOffset: nextScroll };
}

type CyclePathSegments = ReturnType<typeof formatCyclePathSegments>;

function CyclePathLine({
  segments,
  prefix,
  highlightComponents = false,
  highlightLine = false,
}: {
  segments: CyclePathSegments;
  prefix: string;
  highlightComponents?: boolean;
  highlightLine?: boolean;
}): React.ReactElement {
  return (
    <Text color={highlightLine ? PALETTE.warning : undefined}>
      {prefix}
      {segments.map((segment, index) =>
        segment.kind === 'slot' ? (
          <Text key={index} color={PALETTE.info}>
            {segment.text}
          </Text>
        ) : segment.kind === 'arrow' ? (
          <Text key={index} dimColor>
            {segment.text}
          </Text>
        ) : (
          <Text key={index} color={highlightComponents ? PALETTE.warning : undefined}>
            {segment.text}
          </Text>
        ),
      )}
    </Text>
  );
}

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
  createSidebarViewsHelpSection(true),
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
    title: 'Resolving cycles',
    entries: [
      { keys: 'r', label: 'Reject a cycle member (drops it from the push), or' },
      { keys: '', label: "break the cycle by removing a slot's" },
      { keys: '', label: '$allowedComponents edge (see [c] suggested fix).' },
      { keys: 'x', label: 'Break cycle (from [c]): delete a slot edge.' },
    ],
  },
  {
    title: 'Search',
    entries: [{ keys: '/', label: 'Search' }],
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

export { computeCycleAutoRejectTargets } from '../../cycle-auto-reject.js';

export interface BreakingComponent {
  componentName: string;
  changes: BreakingChange[];
  impact?: DownstreamImpact;
  current?: ComponentTypeSummary;
}

export interface BreakingRow {
  label: string;
  componentName: string;
  focusTarget?: { kind: 'prop' | 'slot'; name: string };
}

export function buildBreakingRows(breakingChanges: BreakingComponent[]): BreakingRow[] {
  const out: BreakingRow[] = [];
  for (const b of breakingChanges) {
    if (b.changes.length === 0) {
      out.push({ label: `${b.componentName} — breaking`, componentName: b.componentName });
      continue;
    }
    for (const change of b.changes) {
      const label = formatBreakingChange(change, b.current);
      if ('slotId' in change) {
        out.push({
          label,
          componentName: b.componentName,
          focusTarget: { kind: 'slot', name: change.slotId },
        });
      } else {
        out.push({
          label,
          componentName: b.componentName,
          focusTarget: { kind: 'prop', name: change.propertyId },
        });
      }
    }
  }
  return out;
}

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
      current: item.current,
    });
  }
  return out;
}

export function GenerateReviewStep({
  extractSessionId,
  tokenSessionId,
  onFinalize,
  onQuit,
  livePreview = true,
  spaceId = '',
  environmentId = '',
  cmaToken = '',
  host = '',
  tokensPath = '',
  initialFinalizeError = null,
  allowDeletions = false,
}: GenerateReviewStepProps): React.ReactElement {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;

  const [slotCycles, setSlotCycles] = useState<StoredSlotCycle[]>([]);
  const setLoadedSlotCycles = useCallback((cycles: StoredSlotCycle[] | undefined): void => {
    setSlotCycles(cycles ?? []);
  }, []);
  const loadSessionState = useCallback(
    (): ReviewSessionLoadResult<StoredSlotCycle[]> =>
      loadReviewSessionState({
        extractSessionId,
        tokenSessionId,
        loadExtra: (db, sessionId) => loadSlotCycles(db, sessionId),
        sortEntries: (entries, cycles) => {
          const cycleParticipants = new Set<string>();
          for (const cycle of cycles ?? []) {
            for (const participant of cycle.path) cycleParticipants.add(participant);
          }
          return sortComponentsForSidebar(entries, cycleParticipants);
        },
      }),
    [extractSessionId, tokenSessionId],
  );
  const {
    components,
    setComponents,
    loading,
    loadError,
    availableTokens,
    reloadFromSave: reloadSessionFromSave,
  } = useReviewSession({
    loadSession: loadSessionState,
    tokensPath,
    onExtraLoaded: setLoadedSlotCycles,
  });

  const [nav, setNav] = useState<{ cursorRowIdx: number; sidebarScrollOffset: number }>({
    cursorRowIdx: 0,
    sidebarScrollOffset: 0,
  });
  const cursorRowIdx = nav.cursorRowIdx;
  const sidebarScrollOffset = nav.sidebarScrollOffset;
  const {
    sidebarFocused,
    setSidebarFocused,
    showFinalize,
    setShowFinalize,
    showQuit,
    setShowQuit,
    finalizeError,
    setFinalizeError,
  } = useReviewSurfaceState(initialFinalizeError);
  const [removedBannerCollapsed, setRemovedBannerCollapsed] = useState(false);
  const removedBannerDefaultedRef = useRef(false);
  const [cyclePanelScroll, setCyclePanelScroll] = useState(0);
  const [cyclesCursor, setCyclesCursor] = useState(0);
  const cyclePanel = useOverlayPanel({
    toggleKey: 'c',
    onClose: () => {
      setCyclePanelScroll(0);
      setCyclesCursor(0);
    },
  });
  const breakPanel = useOverlayPanel({
    toggleKey: 'x',
    onClose: () => {
      setBreakCursor(0);
      setBreakConfirm(false);
    },
  });
  const [breakCursor, setBreakCursor] = useState(0);
  const [breakConfirm, setBreakConfirm] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const seededGroupsRef = useRef(false);
  const {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    autocompleteCandidates,
    setAutocompleteCandidates,
    jumpFilterTarget,
    setJumpFilterTarget,
    columnOneView,
    setColumnOneView,
    activeFilters,
    setActiveFilters,
    showHelp,
    setShowHelp,
  } = useSidebarSearchState();
  const lineagePanel = useOverlayPanel({ toggleKey: 'l' });
  const [lineageCursor, setLineageCursor] = useState(0);
  const breakingPanel = useOverlayPanel({ toggleKey: 'b', onClose: () => setBreakingDetailOpen(false) });
  const [breakingChanges, setBreakingChanges] = useState<BreakingComponent[]>([]);
  const [breakingCursor, setBreakingCursor] = useState(0);
  const [breakingDetailOpen, setBreakingDetailOpen] = useState(false);
  const [pendingEditorFocus, setPendingEditorFocus] = useState<{
    componentName: string;
    target: { kind: 'prop' | 'slot'; name: string };
  } | null>(null);
  const [autoRejected, setAutoRejected] = useState<string[]>([]);
  const [undoSnapshot, setUndoSnapshot] = useState<Map<string, ReviewComponentStatus> | null>(null);
  const autoRejectFiredRef = useRef<boolean>(false);

  const [editorDirty, setEditorDirty] = useState(false);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [pendingFocusAway, setPendingFocusAway] = useState<null | 'tab-to-sidebar'>(null);
  const [discardTrigger, setDiscardTrigger] = useState(0);

  const [showReloadDialog, setShowReloadDialog] = useState(false);

  const acceptedCountForPreview = components.filter((c) => c.status === 'accepted').length;
  const { previewAnnotations, removedComponents, livePreviewHook, livePreviewSpinner } = useReviewPreview({
    components,
    loading,
    livePreview,
    sessionId: extractSessionId,
    tokensPath,
    spaceId,
    environmentId,
    cmaToken,
    host,
    deleteAllComponents: acceptedCountForPreview === 0,
    allowDeletions,
    onResult: (response) => {
      const nextRemoved = response.components.removed ?? [];
      if (!removedBannerDefaultedRef.current && nextRemoved.length > 0) {
        removedBannerDefaultedRef.current = true;
        setRemovedBannerCollapsed(nextRemoved.length > 5);
      }
      setBreakingChanges(deriveBreakingChanges(response));
    },
  });

  const finalizePreview = useReviewFinalizePreview({
    open: showFinalize,
    extractSessionId,
    tokensPath,
    spaceId,
    environmentId,
    cmaToken,
    host,
    components,
    allowDeletions,
  });

  const handleFinalizeConfirm = () => {
    const counts = finalizeReviewSession(extractSessionId, components);
    onFinalize(counts.accepted, counts.rejected, counts.unresolved);
  };

  const recomputeCycles = (currentComponents: CdfReviewEntry[]): void => {
    try {
      const view = computeCycleView(currentComponents);
      const rawCycles = view.pushBlocking;
      const next: StoredSlotCycle[] = rawCycles.map((cycle) => ({
        path: cycle.path,
        edges: cycle.edges,
        suggestedBreak: cycle.edges.length > 0 ? suggestCycleBreakEdge(cycle, rawCycles) : null,
      }));
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
      if (next.length === 0) setFinalizeError(null);
    } catch {
      // Defensive: swallow — never let cycle detection crash the review UI.
    }
  };

  const componentGraph = useMemo<ComponentGraphNode[]>(() => buildComponentGraph(components), [components]);
  const sidebarGraph = useMemo<ComponentGraphNode[]>(
    () => buildComponentGraph(components, { stripRejectedEdges: true }),
    [components],
  );
  const closures = useMemo(() => computeAllClosures(componentGraph), [componentGraph]);
  useEffect(() => {
    if (seededGroupsRef.current) return;
    if (closures.size === 0 && slotCycles.length === 0) return;
    seededGroupsRef.current = true;
    setExpandedGroups(
      collectExpandedGroupRoots(
        closures,
        slotCycles.flatMap((cycle) => cycle.path),
      ),
    );
  }, [closures, slotCycles]);
  const directIssues = useMemo<Map<string, NodeStatus>>(() => {
    const m = new Map<string, NodeStatus>();
    for (const c of components) {
      if (c.status === 'rejected') m.set(c.key, 'error');
    }
    return m;
  }, [components]);
  const cycleView = useMemo<CycleView>(() => computeCycleView(components), [components]);

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
    const snapshot = new Map<string, ReviewComponentStatus>();
    const flipped: string[] = [];
    for (const c of components) {
      if (!targets.has(c.key)) continue;
      snapshot.set(c.key, c.status);
      if (c.status !== 'rejected') flipped.push(c.key);
    }
    setComponents((prev) =>
      prev.map((c) => (targets.has(c.key) ? { ...c, status: 'rejected' as ReviewComponentStatus } : c)),
    );
    setAutoRejected(flipped.length > 0 ? flipped : [...targets].sort());
    setUndoSnapshot(flipped.length > 0 ? snapshot : null);
  }, [loading, cycleView, componentGraph, slotCycles]);

  const applyHistorySnapshot = (snap: HistorySnapshot): void => {
    const restored: CdfReviewEntry[] = snap.components.map((c) => ({
      key: c.key,
      entry: c.entry,
      status: c.status,
    }));
    setComponents(restored);
    setAutoRejected(snap.autoRejected);
    setUndoSnapshot(snap.undoSnapshot);
    recomputeCycles(restored);
  };

  const { historySeededRef, pushHistorySnapshot, handleUndo, handleRedo, resetHistory } = useReviewHistory({
    loading,
    components,
    createSnapshot: (entries) =>
      createReviewHistorySnapshot(entries, {
        autoRejected,
        undoSnapshot,
      }),
    applySnapshot: applyHistorySnapshot,
  });

  const autoRejectPushedRef = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (!historySeededRef.current) return;
    if (!autoRejectFiredRef.current) return;
    if (autoRejectPushedRef.current) return;
    autoRejectPushedRef.current = true;
    pushHistorySnapshot(components, 'mount-auto-reject');
  }, [autoRejected]);

  const reloadFromSave = (): void => {
    const result = reloadSessionFromSave();
    if (!result) return;
    const { entries } = result;
    const reloadGraph = buildComponentGraph(entries);
    const reloadClosures = computeAllClosures(reloadGraph);
    const reloadCycleView = computeCycleView(entries);
    setExpandedGroups(collectExpandedGroupRoots(reloadClosures, reloadCycleView.structural));
    seededGroupsRef.current = true;
    setAutoRejected([]);
    setUndoSnapshot(null);
    autoRejectFiredRef.current = false;
    autoRejectPushedRef.current = false;
    resetHistory(createReviewHistorySnapshot(entries));
    setNav({ cursorRowIdx: 0, sidebarScrollOffset: 0 });
    setSaveError(null);
    setFinalizeError(null);
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
  const brokenKeys = useMemo<Set<string>>(
    () => new Set(breakingChanges.map((b) => b.componentName)),
    [breakingChanges],
  );

  const breakingRows = useMemo<BreakingRow[]>(() => buildBreakingRows(breakingChanges), [breakingChanges]);

  const filterVisibleKeys = useMemo<Set<string> | undefined>(() => {
    if (jumpFilterTarget) {
      return findAllAncestorsInclusive(jumpFilterTarget, sidebarGraph);
    }
    const categoryKeys = computeFilterKeys({
      filters: activeFilters,
      data: { cycles: cycleView.structural, broken: brokenKeys },
    });
    const searchKeys = (() => {
      if (!searchQuery) return undefined;
      const matches = groupedItemsMemo.map((it) => it.key).filter((k) => fuzzyMatches(searchQuery, k));
      if (matches.length === 0) return undefined;
      return computeDirectNeighborhood(matches, sidebarGraph);
    })();
    return intersectFilterKeys(categoryKeys, searchKeys);
  }, [jumpFilterTarget, activeFilters, cycleView, brokenKeys, searchQuery, groupedItemsMemo, sidebarGraph]);

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
  const selectableRowPositions = useMemo<number[]>(() => {
    const out: number[] = [];
    for (let i = 0; i < visibleRowsMemo.length; i++) {
      if (visibleRowsMemo[i].itemIdx >= 0) out.push(i);
    }
    return out;
  }, [visibleRowsMemo]);
  const selectedIdx = visibleRowsMemo[cursorRowIdx]?.itemIdx ?? -1;
  const focusedComponentKey: string | null = components[selectedIdx]?.key ?? null;
  const { entries: lineageEntries, jumpables: lineageJumpables } = useLineage(focusedComponentKey, componentGraph);

  const { sidebarVisibleCount: visibleCount, panelMaxRows } = computeSidebarBudget({
    rows: stdout?.rows ?? FALLBACK_ROWS,
    panelOpen: lineagePanel.isOpen,
    entryCount: lineageEntries.length,
  });
  useEffect(() => {
    if (selectableRowPositions.length === 0) return;
    const cursorInRange = selectableRowPositions.includes(cursorRowIdx);
    const maxScroll = Math.max(0, visibleRowsMemo.length - visibleCount);
    const scrollNeedsClamp = sidebarScrollOffset > maxScroll;
    if (cursorInRange && !scrollNeedsClamp) return;
    const nextCursor = cursorInRange ? cursorRowIdx : selectableRowPositions[0];
    setNav(() => ({
      cursorRowIdx: nextCursor,
      sidebarScrollOffset: Math.min(sidebarScrollOffset, maxScroll),
    }));
  }, [selectableRowPositions, cursorRowIdx, sidebarScrollOffset, visibleRowsMemo.length, visibleCount]);

  const reviewEditor = useReviewEditor({
    components,
    selectedIdx,
    extractSessionId,
    availableTokens,
    setComponents,
    pushHistorySnapshot,
    onEditSaved: (entries) => {
      recomputeCycles(entries);
      livePreviewHook.trigger();
      pushHistorySnapshot(entries, 'edit-save');
    },
    onTokenSaved: () => livePreviewHook.trigger(),
  });

  const {
    panelOpen,
    setPanelOpen,
    setPanelScrollOffset,
    setJsonScrollOffset,
    setTextEntryActive,
    showJson,
    showHiddenProps,
    draftValue,
    setDraftValue,
    saveError,
    setSaveError,
    currentTokenSuggestions,
    handleEditSave,
    handleEditDiscard,
  } = reviewEditor;

  const { reviewMetadata, componentRationale } = useReviewMetadata({
    components,
    selectedIdx,
    extractSessionId,
  });

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

  const selectionStateByKey = useMemo<Map<string, 'accepted' | 'rejected' | 'undecided'>>(() => {
    const map = new Map<string, 'accepted' | 'rejected' | 'undecided'>();
    for (const c of components) {
      if (c.status === 'accepted') map.set(c.key, 'accepted');
      else if (c.status === 'rejected') map.set(c.key, 'rejected');
      else map.set(c.key, 'undecided');
    }
    return map;
  }, [components]);

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
  const searchMatchCount = useMemo<number>(() => {
    if (searchMatches.length === 0) return 0;
    const seen = new Set<number>();
    for (const pos of searchMatches) {
      const itemIdx = visibleRowsMemo[pos]?.itemIdx;
      if (itemIdx != null && itemIdx >= 0) seen.add(itemIdx);
    }
    return seen.size;
  }, [searchMatches, visibleRowsMemo]);

  const dimPredicate = useMemo(
    () =>
      buildFlatDimPredicate({
        viewMode: columnOneView,
        searchQuery,
        filterVisibleKeys,
      }),
    [columnOneView, searchQuery, filterVisibleKeys],
  );

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

  const breakEdges = useMemo<BreakEdge[]>(() => {
    const cycle = slotCycles[cyclesCursor];
    if (!cycle) return [];
    return enumerateCycleBreaks(cycle, components);
  }, [slotCycles, cyclesCursor, components]);

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
    pushHistorySnapshot(next, 'break-cycle-edge');
  };

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
    pushHistorySnapshot(next, 'reject-cascade');
  };

  const dialogOpen = showFinalize || showQuit;

  useImmediateInput((input, key) => {
    if (
      handleReviewOverlayInput(input, key, {
        loading,
        loadError,
        showFinalize,
        dialogOpen,
        showHelp,
        showReloadDialog,
        finalizePreview,
        reloadFromSave,
        setShowReloadDialog,
        onQuit,
        handleUndo,
        handleRedo,
      })
    )
      return;

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
      setShowUnsavedWarning(false);
      setPendingFocusAway(null);
      return;
    }

    if (searchOpen) {
      if (key.escape) {
        setSearchOpen(false);
        setSearchQuery('');
        setAutocompleteCandidates([]);
        return;
      }
      if (key.return) {
        setAutocompleteCandidates([]);
        if (!searchQuery || searchMatches.length === 0) {
          setSearchOpen(false);
          setSearchQuery('');
          return;
        }
        let jumped = false;
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
          jumpCursorToRow(searchMatches[0]);
        }
        setSearchOpen(false);
        return;
      }
      if (
        handleSidebarSearchInput(input, key, {
          query: searchQuery,
          names: components.map((c) => c.key),
          setQuery: setSearchQuery,
          setCandidates: setAutocompleteCandidates,
        })
      )
        return;
      return;
    }

    if (breakingPanel.isOpen) {
      if (breakingPanel.handleInput(input, key)) return;
      if (input === 'D') {
        setBreakingDetailOpen((prev) => !prev);
        return;
      }
      if (key.upArrow || input === 'k') {
        setBreakingDetailOpen(false);
        setBreakingCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setBreakingDetailOpen(false);
        setBreakingCursor((c) => Math.min(Math.max(0, breakingRows.length - 1), c + 1));
        return;
      }
      if (key.return) {
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
    if (lineagePanel.isOpen) {
      if (lineagePanel.handleInput(input, key)) return;
      if (
        handleLineageNavigation({
          input,
          key,
          cursor: lineageCursor,
          jumpables: lineageJumpables,
          onCursorChange: setLineageCursor,
          onJump: jumpCursorToName,
          onClose: lineagePanel.close,
          allowTab: true,
        })
      )
        return;
      return;
    }
    if (breakPanel.isOpen) {
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
      if (key.upArrow || input === 'k') {
        setBreakCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setBreakCursor((c) => Math.min(Math.max(0, breakEdges.length - 1), c + 1));
        return;
      }
      if (key.return) {
        if (breakEdges[breakCursor]) setBreakConfirm(true);
        return;
      }
      return;
    }
    if (cyclePanel.isOpen) {
      if (input === 'x' && breakEdges.length > 0) {
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
    if (input === 'c' && sidebarFocused && slotCycles.length > 0) {
      cyclePanel.open();
      setCyclePanelScroll(0);
      setCyclesCursor(0);
      return;
    }
    if (input === 'l' && sidebarFocused && focusedComponentKey) {
      lineagePanel.open();
      setLineageCursor(0);
      return;
    }
    if (input === 'b' && sidebarFocused && breakingChanges.length > 0) {
      breakingPanel.open();
      setBreakingCursor(0);
      return;
    }
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
    if (input === 'i' && sidebarFocused && !key.tab && !key.ctrl && !key.meta && focusedComponentKey) {
      const t = focusedComponentKey;
      setJumpFilterTarget((prev) => (prev === t ? null : t));
      return;
    }

    if (handleReviewPanelShortcuts(input, key, { ...reviewEditor, propKey: 'p', componentKey: 'P' })) return;

    if (key.tab) {
      if (!sidebarFocused && editorDirty) {
        setPendingFocusAway('tab-to-sidebar');
        setShowUnsavedWarning(true);
        return;
      }
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

    if (
      handleJsonPanelInput(input, key, {
        ...reviewEditor,
        sidebarFocused,
        showJson,
        jsonValue: getReviewJsonPanelValue(components[selectedIdx] ?? null, showHiddenProps),
        height: PANEL_HEIGHT,
      })
    )
      return;

    if (!sidebarFocused) return;

    if (input === '/') {
      setSearchOpen(true);
      return;
    }
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
      const acceptedNames = new Set(components.filter((c) => c.status === 'accepted').map((c) => c.key));
      const acceptedSubgraph: ComponentGraphNode[] = componentGraph.filter((n) => acceptedNames.has(n.name));
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
      const currentKey =
        cursorRowIdx >= 0 && cursorRowIdx < visibleRowsMemo.length
          ? (components[visibleRowsMemo[cursorRowIdx]?.itemIdx ?? -1]?.key ?? null)
          : null;
      const next = computeSidebarViewToggle({
        currentView: columnOneView,
        currentKey,
        currentScroll: sidebarScrollOffset,
        visibleCount,
        items: groupedItemsMemo,
        cycleParticipants: cycleView.structural,
        expandedGroups,
        graph: sidebarGraph,
      });
      setColumnOneView(next.view);
      setNav({ cursorRowIdx: next.cursor, sidebarScrollOffset: next.scroll });
      return;
    }
    if (input === 'a') {
      const current = components[selectedIdx];
      if (!current) return;
      const cascade = computeAcceptCascade(current.key, componentGraph);
      const next = components.map((c) =>
        cascade.has(c.key) ? { ...c, status: 'accepted' as ReviewComponentStatus } : c,
      );
      setComponents(next);
      setFinalizeError(null);
      recomputeCycles(next);
      pushHistorySnapshot(next, 'accept-cascade');
      return;
    }
    if (input === 'r') {
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
      pushHistorySnapshot(next, 'bulk-accept');
      return;
    }
    if (input === 'E') {
      setExpandedGroups(collectExpandedGroupRoots(closures, cycleView.structural));
      return;
    }
    if (input === 'C') {
      setExpandedGroups(new Set());
      return;
    }
    if (handleReviewViewToggleInput(input, reviewEditor)) return;

    if (key.return) {
      const current = components[selectedIdx];
      if (!current) return;
      const rs = renderStatusByKey.get(current.key);
      if (!rs || rs.isOwn) return;
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
      setNav(({ cursorRowIdx: previousRow, sidebarScrollOffset: previousScroll }) =>
        moveSelectableCursor({
          direction: 'up',
          previousRow,
          previousScroll,
          positions: selectableRowPositions,
          visibleCount,
        }),
      );
      setJsonScrollOffset(0);
      setDraftValue('');
      setSaveError(null);
      setPendingEditorFocus(null);
    } else if (key.downArrow || input === 'j') {
      setNav(({ cursorRowIdx: previousRow, sidebarScrollOffset: previousScroll }) =>
        moveSelectableCursor({
          direction: 'down',
          previousRow,
          previousScroll,
          positions: selectableRowPositions,
          visibleCount,
        }),
      );
      setJsonScrollOffset(0);
      setDraftValue('');
      setSaveError(null);
      setPendingEditorFocus(null);
    }
  });

  if (loading) {
    return <ReviewLoadingState />;
  }

  if (loadError) {
    return <ReviewLoadError message={loadError} />;
  }

  if (showHelp) {
    return <HelpOverlay sections={HELP_SECTIONS} onClose={() => setShowHelp(false)} />;
  }

  const renderBreakOverlay = (width?: number): React.ReactElement => {
    const highlightedCycle = slotCycles[cyclesCursor];
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.warning} paddingX={1} width={width}>
        <Text bold color={PALETTE.warning}>
          {`BREAK CYCLE ${cyclesCursor + 1} — remove a slot edge or reject a member`}
        </Text>
        {highlightedCycle && (
          <CyclePathLine segments={formatCyclePathSegments(highlightedCycle)} prefix="  " highlightComponents />
        )}
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
        {breakConfirm ? (
          <>
            <Text> </Text>
            <Text bold color={PALETTE.warning}>
              {'Delete this slot edge? [y] confirm  [n] cancel'}
            </Text>
          </>
        ) : (
          <Text dimColor>{'[↑↓/j/k] move  [Enter] delete  [x/Esc] close'}</Text>
        )}
      </Box>
    );
  };
  const breakOverlayFullScreen =
    breakPanel.isOpen &&
    shouldBreakOverlayGoFullScreen({
      rows: stdout?.rows ?? FALLBACK_ROWS,
      edgeCount: breakEdges.length,
    });
  if (breakOverlayFullScreen) {
    return renderBreakOverlay();
  }

  const selected = components[selectedIdx] ?? null;
  const selectedJson = selected ? JSON.stringify({ [selected.key]: selected.entry }, null, 2) : '';
  const visibleJsonPanelValue = getReviewJsonPanelValue(selected, showHiddenProps);

  const isEmpty = (c: CdfReviewEntry): boolean =>
    Object.keys(c.entry.$properties).length === 0 && Object.keys(c.entry.$slots ?? {}).length === 0;
  const emptyCount = components.filter(isEmpty).length;

  const cycleParticipantSet = cycleView.structural;

  const sidebarSuffix = (c: CdfReviewEntry): string => {
    if (cycleParticipantSet.has(c.key)) return ' (cycle)';
    if (isEmpty(c)) return ' (empty)';
    return '';
  };

  const groupedItems = groupedItemsMemo;

  const previewAnnotationByKey = previewAnnotations;

  const longestName = components.reduce((m, c) => {
    const suffixLen = sidebarSuffix(c).length;
    const groupOverhead = 12; // "▸  (99 deps) ✗"
    return Math.max(m, c.key.length + Math.max(suffixLen, groupOverhead));
  }, 0);
  const sidebarWidthCap = computeSidebarWidth(terminalWidth);
  const sidebarWidth = Math.min(Math.max(longestName + 9, 18), sidebarWidthCap);
  const panelWidth = Math.max(10, terminalWidth - sidebarWidth - 4);

  const projectSlotGraph = components.map((c) => ({
    name: c.key,
    slots: Object.entries(c.entry.$slots ?? {}).map(([slotName, slotDef]) => ({
      name: slotName,
      allowedComponents: Array.isArray(slotDef?.$allowedComponents)
        ? (slotDef.$allowedComponents as string[]).filter((v): v is string => typeof v === 'string')
        : [],
    })),
  }));

  const hasGroupRoots = (() => {
    for (const c of closures.values()) if (c.nodes.length > 1) return true;
    return false;
  })();

  const { accepted, rejected, needsReview } = countReviewStatuses(components);
  const propCount = selected ? Object.keys(selected.entry.$properties).length : 0;
  const slotCount = selected?.entry.$slots ? Object.keys(selected.entry.$slots).length : 0;

  return (
    <Box flexDirection="column">
      {showFinalize && (
        <FinalizeDialog
          accepted={accepted}
          rejected={rejected}
          needsReview={needsReview}
          removed={finalizePreview.removed}
          previewStatus={finalizePreview.status}
          removedScrollOffset={finalizePreview.scrollOffset}
          onConfirm={handleFinalizeConfirm}
          onCancel={() => setShowFinalize(false)}
        />
      )}
      {showQuit && <QuitDialog hasUnsavedDrafts={false} onConfirm={onQuit} onCancel={() => setShowQuit(false)} />}
      {showUnsavedWarning && !dialogOpen && (
        <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.warning} paddingX={1}>
          <Text bold color={PALETTE.warning}>
            Unsaved changes
          </Text>
          <Text>You have unsaved edits in the current field editor.</Text>
          <Text> </Text>
          <Text>{'  [Enter]  Save and continue'}</Text>
          <Text>{'  [Esc]    Discard changes and continue'}</Text>
          <Text>{'  [Tab]    Stay in the panel'}</Text>
        </Box>
      )}
      {showReloadDialog && !dialogOpen && (
        <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.warning} paddingX={1}>
          <Text bold color={PALETTE.warning}>
            Reload from saved state?
          </Text>
          <Text>Unsaved in-memory changes will be lost.</Text>
          <Text> </Text>
          <Text>{'  [Enter]  Confirm'}</Text>
          <Text>{'  [Esc]    Cancel'}</Text>
        </Box>
      )}
      {removedComponents.length > 0 && !dialogOpen && (
        <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.error} paddingX={1}>
          <Text bold color={PALETTE.error}>
            {removedComponentsHeader(removedComponents.length, true)}
          </Text>
          {!removedBannerCollapsed && (
            <>
              <Text> </Text>
              {removedComponents.map((rc) => (
                <Text key={rc.id}>{removedComponentLine(rc)}</Text>
              ))}
            </>
          )}
        </Box>
      )}
      {breakingChanges.length > 0 && !dialogOpen && (
        <Box paddingX={1}>
          <Text
            color={PALETTE.warning}
          >{`[b] ${breakingChanges.length} breaking change${breakingChanges.length === 1 ? '' : 's'}`}</Text>
        </Box>
      )}
      {breakingPanel.isOpen &&
        breakingDetailOpen &&
        !dialogOpen &&
        (() => {
          const row = breakingRows[breakingCursor];
          const comp = row ? breakingChanges.find((b) => b.componentName === row.componentName) : undefined;
          if (!comp) return null;
          return (
            <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.warning} paddingX={1}>
              <Text bold color={PALETTE.warning}>{`Breaking changes — ${comp.componentName}`}</Text>
              {comp.impact && (
                <Text dimColor>
                  {`  affects ${comp.impact.affectedExperiences} experience${comp.impact.affectedExperiences === 1 ? '' : 's'}, ${comp.impact.affectedFragments} fragment${comp.impact.affectedFragments === 1 ? '' : 's'}`}
                </Text>
              )}
              {comp.changes.length === 0 ? (
                <Text dimColor>{'  (no enumerated changes)'}</Text>
              ) : (
                comp.changes.map((change, ci) => (
                  <Text key={`bd-detail-${ci}`}>{`  • ${formatBreakingChange(change, comp.current)}`}</Text>
                ))
              )}
              <Text dimColor>{'[D/Esc] close detail'}</Text>
            </Box>
          );
        })()}
      {cyclePanel.isOpen &&
        !dialogOpen &&
        (() => {
          const PANEL_H = 20;
          const lines: React.ReactElement[] = [];
          lines.push(
            <Text key="cyc-title" bold color={PALETTE.warning}>
              {`SLOT DEPENDENCY CYCLES (${slotCycles.length})`}
            </Text>,
          );
          lines.push(
            <Text key="cyc-sub" dimColor>
              {'push will fail until these are resolved'}
            </Text>,
          );
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
            lines.push(
              <CyclePathLine key={`cyc-p-${idx}`} segments={formatCyclePathSegments(cycle, 16)} prefix="    " />,
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
            <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.warning} paddingX={1}>
              {visible}
              <Text dimColor>{'[↑↓/j/k] move  [Enter] jump  [x] break cycle  [c/q/Esc] close'}</Text>
            </Box>
          );
        })()}
      {!dialogOpen && (
        <LivePreviewSummary
          enabled={livePreview}
          previewAnnotations={previewAnnotations}
          status={livePreviewHook.status}
          disabled={livePreviewHook.disabled}
          spinner={livePreviewSpinner}
        />
      )}
      {!dialogOpen &&
        autoRejected.length > 0 &&
        (() => {
          const stillRejected = autoRejected.filter((name) => {
            const c = components.find((x) => x.key === name);
            return c?.status === 'rejected';
          });
          if (stillRejected.length === 0) return null;
          const participantSet = cycleView.structural;
          const members = stillRejected.filter((n) => participantSet.has(n)).sort();
          const ancestors = stillRejected.filter((n) => !participantSet.has(n)).sort();
          return (
            <Box flexDirection="column" borderStyle="single" borderColor={PALETTE.error} paddingX={1}>
              <Text color={PALETTE.error} bold>
                {`Cyclic manifest — auto-rejected ${stillRejected.length} component${stillRejected.length === 1 ? '' : 's'}:`}
              </Text>
              {members.length > 0 && <Text color={PALETTE.error}>{`  Cycle members: ${members.join(', ')}`}</Text>}
              {ancestors.length > 0 && <Text color={PALETTE.error}>{`  Ancestors: ${ancestors.join(', ')}`}</Text>}
              <Text dimColor>
                {undoSnapshot
                  ? '  [Ctrl+Z] undo · [r]/[a] manually toggle · [F] continue'
                  : '  [r]/[a] manually toggle · [F] continue'}
              </Text>
            </Box>
          );
        })()}
      {!dialogOpen && emptyCount > 0 && (
        <Text color={PALETTE.warning}>
          {`⚠ ${emptyCount} component${emptyCount === 1 ? '' : 's'} had no classifiable props — review with care`}
        </Text>
      )}
      {!dialogOpen && finalizeError && <Text color={PALETTE.error}>{`⚠ ${finalizeError}`}</Text>}
      {!dialogOpen && (
        <Box>
          {breakingPanel.isOpen ? (
            <GotoBanner
              title="Breaking changes"
              rows={breakingRows.map((r) => ({
                label: r.label,
                jumpTarget: r.componentName,
              }))}
              cursor={breakingCursor}
              maxRows={panelMaxRows}
              width={sidebarWidth}
              footerHint="[↑/↓] move · [Enter] jump · [D] detail · [Esc] close"
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
                <ReviewDetailsEditor
                  selectedKey={selected.key}
                  componentRationale={componentRationale}
                  reviewMetadata={reviewMetadata}
                  reviewEditor={reviewEditor}
                  width={panelWidth}
                  height={PANEL_HEIGHT}
                  jsonValue={visibleJsonPanelValue}
                  sidebarFocused={sidebarFocused}
                  fieldEditor={{
                    key:
                      pendingEditorFocus && pendingEditorFocus.componentName === selected.key
                        ? `${selected.key}::${pendingEditorFocus.target.kind}:${pendingEditorFocus.target.name}`
                        : selected.key,
                    value: draftValue || selectedJson,
                    showHiddenProps,
                    onChange: setDraftValue,
                    onSave: handleEditSave,
                    onDiscard: handleEditDiscard,
                    onExit: () => setSidebarFocused(true),
                    onTogglePropRationale: () => {
                      setPanelOpen('prop-rationale');
                      setPanelScrollOffset(() => 0);
                    },
                    propRationaleKey: 'p',
                    componentRationaleKey: 'P',
                    onToggleComponentRationale: () => {
                      setPanelOpen('component-rationale');
                      setPanelScrollOffset(() => 0);
                    },
                    onToggleSourceExternal: () => {
                      setPanelOpen('source');
                      setPanelScrollOffset(() => 0);
                    },
                    onTextEntryActiveChange: setTextEntryActive,
                    projectSlotGraph,
                    currentComponentName: selected.key,
                    onDirtyChange: setEditorDirty,
                    discardTrigger,
                    initialFocusTarget:
                      pendingEditorFocus && pendingEditorFocus.componentName === selected.key
                        ? pendingEditorFocus.target
                        : { kind: 'description' },
                  }}
                />
                {saveError && <Text color={PALETTE.error}>{'✗ ' + saveError}</Text>}
                <Text dimColor>
                  {panelOpen === 'token-review'
                    ? '  [↑/↓] move  [Enter] edit allowed  [Esc] close'
                    : sidebarFocused
                      ? hasGroupRoots
                        ? '  [Space] expand/collapse group  [E/C] expand/collapse all'
                        : ''
                      : showJson
                        ? '  [j/k] scroll  [Ctrl+u/d] half-page  [gg/G] top/bottom  [Tab] focus list'
                        : '  [Tab] focus list  (edit fields)' +
                          (currentTokenSuggestions().length > 0 ? '  [t] token review' : '')}
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
          <Text color={PALETTE.warning}>
            {`⚠ ${slotCycles.length} slot dependency cycle${slotCycles.length === 1 ? '' : 's'} detected — push will fail`}
          </Text>
          {slotCycles.slice(0, 3).map((cycle, idx) => {
            return (
              <CyclePathLine
                key={`cyc-banner-${idx}`}
                segments={formatCyclePathSegments(cycle)}
                prefix="  Cycle: "
                highlightComponents
                highlightLine
              />
            );
          })}
          {slotCycles.length > 3 && <Text color={PALETTE.warning}>{`  …${slotCycles.length - 3} more`}</Text>}
          <Text dimColor>{'  press [c] for detail'}</Text>
        </Box>
      )}
      <SearchMatchSummary
        open={searchOpen}
        query={searchQuery}
        matches={searchMatchCount}
        total={components.length}
        autocompleteCandidates={autocompleteCandidates}
        hidden={dialogOpen}
      />
      {!dialogOpen && sidebarFocused && (
        <Box columnGap={2} flexWrap="wrap">
          {panelOpen === 'token-review' ? (
            <>
              {legendEntry('[↑/↓]', 'move')}
              {legendEntry('[Enter]', 'edit allowed')}
              {legendEntry('[Esc]', 'close')}
            </>
          ) : (
            <>
              {legendEntry('[j/k]', 'move')}
              {legendEntry('[a]', 'accept')}
              {legendEntry('[r]', 'reject')}
              {legendEntry('[A]', 'accept all')}
              {legendEntry('[F]', 'finalize')}
              {legendEntry('[L]', 'flat', columnOneView === 'flat')}
              {legendEntry('[l]', 'lineage', lineagePanel.isOpen)}
              {legendEntry('[i]', 'focus lineage', jumpFilterTarget !== null)}
              {legendEntry('[w]', 'only breaking', activeFilters.has('broken'))}
              {slotCycles.length > 0 && legendEntry('[o]', 'only cycles', activeFilters.has('cycles'))}
              {slotCycles.length > 0 && legendEntry('[c]', 'cycle list', cyclePanel.isOpen)}
              {legendEntry('[p]', 'prop rationale', panelOpen === 'prop-rationale')}
              {legendEntry('[P]', 'component rationale', panelOpen === 'component-rationale')}
              {legendEntry('[s]', 'source', panelOpen === 'source')}
              {currentTokenSuggestions().length > 0 && legendEntry('[t]', 'token review')}
              {legendEntry('[J]', showJson ? 'hide JSON' : 'show JSON', showJson)}
              {legendEntry('[H]', showHiddenProps ? 'hide state/unattached' : 'show state/unattached', showHiddenProps)}
              {breakingChanges.length > 0 && legendEntry('[b]', 'see breaking changes', breakingPanel.isOpen)}
              {removedComponents.length > 0 &&
                legendEntry('[d]', removedBannerCollapsed ? 'show removed' : 'hide removed', !removedBannerCollapsed)}
              {legendEntry('[/]', 'search', searchOpen || searchQuery.length > 0)}
              {legendEntry('[Tab]', 'focus panel')}
              {legendEntry('[Ctrl+Z]', 'undo')}
              {legendEntry('[Ctrl+Y]', 'redo')}
              {legendEntry('[Ctrl+R]', 'reload')}
              {legendEntry('[?]', 'help')}
              {legendEntry('[q]', 'quit')}
            </>
          )}
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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import type {
  CDFComponentEntry,
  ComponentTypeSummary,
  ServerPreviewResponse,
} from '@contentful/experience-design-system-types';
import {
  GroupedSidebar,
  buildVisibleRows,
  type VisibleRow,
} from '../../../analyze/select/tui/components/GroupedSidebar.js';
import { computeAllClosures, type ComponentGraphNode, type NodeStatus } from '../../../analyze/composite-closure.js';
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
import { RationalePanel, type RationaleRow } from '../../../analyze/select/tui/components/RationalePanel.js';
import { ComponentRationalePanel } from '../../../analyze/select/tui/components/ComponentRationalePanel.js';
import type { FieldEditorMetadata } from '../../../analyze/select/tui/components/FieldEditor.js';
import type { PreviewAnnotation, ReviewComponentStatus } from '../../../analyze/select/types.js';
import { applyPreviewAnnotations } from '../../../analyze/select/preview-annotations.js';
import { useLivePreview } from '../useLivePreview.js';
import { computeNextScrollOffset } from '../../../analyze/select/tui/hooks/scroll-offset.js';
import { fuzzyMatches } from '../../../analyze/fuzzy-search.js';

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
export function sortComponentsForSidebar<T extends { key: string; entry: CDFComponentEntry }>(components: T[]): T[] {
  const isEmpty = (entry: CDFComponentEntry): boolean =>
    Object.keys(entry.$properties ?? {}).length === 0 && Object.keys(entry.$slots ?? {}).length === 0;
  return [...components].sort((a, b) => {
    const aEmpty = isEmpty(a.entry);
    const bEmpty = isEmpty(b.entry);
    if (aEmpty !== bEmpty) return aEmpty ? -1 : 1;
    return a.key.localeCompare(b.key);
  });
}

const VISIBLE_COUNT = 20;
const PANEL_HEIGHT = 22;

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
  const [showRemovedPanel, setShowRemovedPanel] = useState(false);
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
  const [showCyclePanel, setShowCyclePanel] = useState(false);
  const [cyclePanelScroll, setCyclePanelScroll] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const seededGroupsRef = useRef(false);
  // Fuzzy-search overlay (mirrors ScopeGateStep). `/` opens the input;
  // Enter closes but preserves the query so dim persists; Tab cycles matches
  // once the input is closed; Esc from input closes+clears, Esc from
  // sidebar-with-active-query clears.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleLivePreviewResult = (response: ServerPreviewResponse | null): void => {
    if (!response) return;
    setPreviewAnnotations(
      applyPreviewAnnotations(
        response,
        components.map((c) => c.key),
      ),
    );
    setRemovedComponents(response.components.removed ?? []);
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

  useEffect(() => {
    async function load() {
      const db = openPipelineDb();
      let cdfComponents: Array<{ key: string; entry: CDFComponentEntry }>;
      let cycles: StoredSlotCycle[] = [];
      try {
        cdfComponents = loadCDFComponents(db, extractSessionId);
        cycles = loadSlotCycles(db, extractSessionId);
      } finally {
        db.close();
      }
      if (cdfComponents.length === 0) {
        setLoadError('No generated definitions found for this session. Try re-running generate.');
        setLoading(false);
        return;
      }
      const reviewEntries: CdfReviewEntry[] = cdfComponents.map(({ key, entry }) => ({
        key,
        entry,
        status: 'needs-review',
      }));
      const cycleParticipants = new Set<string>();
      for (const c of cycles) for (const p of c.path) cycleParticipants.add(p);
      setSlotCycles(cycles);
      setComponents(sortComponentsForSidebar(reviewEntries, cycleParticipants));
      setLoading(false);
    }
    load().catch((e: unknown) => {
      setLoadError(String(e));
      setLoading(false);
    });
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

  const updateStatus = (idx: number, status: ReviewComponentStatus) => {
    setComponents((prev) => prev.map((c, i) => (i === idx ? { ...c, status } : c)));
  };

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
      const graph = currentComponents
        .filter((c) => c.status !== 'rejected')
        .map((c) => ({
          name: c.key,
          slots: Object.entries(c.entry.$slots ?? {}).map(([slotName, slotDef]) => ({
            name: slotName,
            allowedComponents: Array.isArray(slotDef?.$allowedComponents)
              ? (slotDef.$allowedComponents as unknown[]).filter((v): v is string => typeof v === 'string')
              : [],
          })),
        }));
      const rawCycles = findSlotCycles(graph);
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
  const componentGraph = useMemo<ComponentGraphNode[]>(
    () =>
      components.map((c) => ({
        name: c.key,
        slots: Object.entries(c.entry.$slots ?? {}).map(([slotName, slotDef]) => ({
          name: slotName,
          allowedComponents: Array.isArray(slotDef?.$allowedComponents)
            ? (slotDef.$allowedComponents as unknown[]).filter((v): v is string => typeof v === 'string')
            : [],
        })),
      })),
    [components],
  );
  const closures = useMemo(() => computeAllClosures(componentGraph), [componentGraph]);
  useEffect(() => {
    if (seededGroupsRef.current) return;
    if (closures.size === 0) return;
    seededGroupsRef.current = true;
    setExpandedGroups(new Set(closures.keys()));
  }, [closures]);
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
  const cycleParticipantsMemo = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    for (const cyc of slotCycles) for (const p of cyc.path) set.add(p);
    return set;
  }, [slotCycles]);
  const groupedItemsMemo = useMemo(
    () =>
      components.map((c) => ({
        key: c.key,
        entry: c.entry,
        status: (directIssues.get(c.key) ?? 'ok') as NodeStatus,
      })),
    [components, directIssues],
  );
  const visibleRowsMemo = useMemo<VisibleRow[]>(
    () =>
      buildVisibleRows({
        items: groupedItemsMemo,
        cycleParticipants: cycleParticipantsMemo,
        expandedGroups,
      }),
    [groupedItemsMemo, cycleParticipantsMemo, expandedGroups],
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
  useEffect(() => {
    if (selectableRowPositions.length === 0) return;
    if (selectableRowPositions.includes(cursorRowIdx)) return;
    setNav((prev) => ({ ...prev, cursorRowIdx: selectableRowPositions[0] }));
  }, [selectableRowPositions, cursorRowIdx]);

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

  const dimPredicate = useMemo(() => {
    if (!searchQuery) return undefined;
    return (name: string) => !fuzzyMatches(searchQuery, name);
  }, [searchQuery]);

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
      else if (rowIdx >= prev + VISIBLE_COUNT) nextOff = rowIdx - VISIBLE_COUNT + 1;
      return { cursorRowIdx: rowIdx, sidebarScrollOffset: nextOff };
    });
    setJsonScrollOffset(0);
    setDraftValue('');
    setSaveError(null);
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
    } catch (e) {
      setSaveError(String(e));
    }
  };

  const handleEditDiscard = () => {
    setDraftValue('');
    setSaveError(null);
  };

  const dialogOpen = showFinalize || showQuit;

  useImmediateInput((input, key) => {
    if (loading || loadError) return;
    if (dialogOpen) return;

    // Fuzzy-search input mode owns most keystrokes while the input is open.
    // Mirrors ScopeGateStep's `/` UX: Esc closes + clears, Enter closes but
    // preserves the query (dim persists), Backspace deletes, printable chars
    // append.
    if (searchOpen) {
      if (key.escape) {
        setSearchOpen(false);
        setSearchQuery('');
        return;
      }
      if (key.return) {
        if (searchQuery) {
          let jumped = false;
          for (let i = Math.max(0, cursorRowIdx); i < visibleRowsMemo.length; i++) {
            const row = visibleRowsMemo[i];
            if (row.itemIdx < 0) continue;
            const key2 = components[row.itemIdx]?.key;
            if (key2 && fuzzyMatches(searchQuery, key2)) {
              jumpCursorToRow(i);
              jumped = true;
              break;
            }
          }
          if (!jumped && searchMatches.length > 0) {
            jumpCursorToRow(searchMatches[0]);
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

    // Pilot-2026-06-24: removed-detail panel. When open, only `d` (toggle)
    // and Esc (close) respond — all other input is swallowed so j/k/Enter/
    // Ctrl+S can't move state behind the modal. Mirrors the `?` overlay
    // pattern from 8f0c62e in FieldEditor.
    if (showRemovedPanel) {
      if (input === 'd' || key.escape) {
        setShowRemovedPanel(false);
      }
      return;
    }
    // INTEG-4401: slot-cycle detail panel. Same modal-swallow rules as
    // showRemovedPanel; q/Esc close, ↑↓ scroll.
    if (showCyclePanel) {
      if (input === 'c' || input === 'q' || key.escape) {
        setShowCyclePanel(false);
        setCyclePanelScroll(0);
        return;
      }
      if (key.upArrow || input === 'k') {
        setCyclePanelScroll((v) => Math.max(0, v - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setCyclePanelScroll((v) => v + 1);
        return;
      }
      return;
    }
    // Open the cycle panel from sidebar-focused state when there is at
    // least one cycle to display.
    if (input === 'c' && sidebarFocused && slotCycles.length > 0) {
      setShowCyclePanel(true);
      setCyclePanelScroll(0);
      return;
    }
    // `d` opens the panel only when live-preview is enabled and there is at
    // least one removed component to display. Sidebar-focused only so it
    // doesn't collide with FieldEditor input.
    if (input === 'd' && sidebarFocused && livePreview && removedComponents.length > 0) {
      setShowRemovedPanel(true);
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
      if (togglable && input === 'i' && panelOpen === 'prop-rationale') {
        setPanelOpen('none');
        setPanelScrollOffset(() => 0);
        return;
      }
      if (togglable && input === 'I' && panelOpen === 'component-rationale') {
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
      if (togglable && input === 'i') {
        setPanelOpen('prop-rationale');
        setPanelScrollOffset(() => 0);
        return;
      }
      if (togglable && input === 'I') {
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
      if (input === 'i') {
        setPanelOpen('prop-rationale');
        setPanelScrollOffset(() => 0);
        return;
      }
      if (input === 'I') {
        setPanelOpen('component-rationale');
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
      // With an active fuzzy-search query, Tab cycles matches from the
      // sidebar-focused state instead of toggling focus. Preserves scope-gate
      // parity. When no query is active, Tab behaves as before.
      if (sidebarFocused && searchQuery && searchMatches.length > 0) {
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
      setSidebarFocused((prev) => !prev);
      return;
    }
    if (input === 'e' && sidebarFocused) {
      setSidebarFocused(false);
      return;
    }
    if (input === ' ' && sidebarFocused && !showJson) {
      const current = components[selectedIdx];
      if (!current) return;
      const rootName = closures.has(current.key)
        ? current.key
        : [...closures.entries()].find(([, c]) => c.nodes.some((n) => n.name === current.key))?.[0];
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
    if (key.escape && searchQuery) {
      setSearchQuery('');
      return;
    }
    if (input === 'q') {
      setShowQuit(true);
      return;
    }
    if (input === 'F') {
      // INTEG-4401: refuse to open the finalize dialog while any slot cycle
      // is unresolved. The push-time hard block (`assertNoSlotCycles`) would
      // catch this downstream, but showing an inline banner here saves the
      // operator from confirming the dialog only to hit a stderr crash.
      if (slotCycles.length > 0) {
        setFinalizeError('Cannot finalize — resolve slot dependency cycle(s) first (press [c] for detail)');
        return;
      }
      setShowFinalize(true);
      return;
    }
    if (input === 'a') {
      updateStatus(selectedIdx, 'accepted');
      setFinalizeError(null);
      return;
    }
    if (input === 'r') {
      // INTEG-4401 (Fix 4): rejecting removes the component from the effective
      // manifest, so recompute cycles across the reduced graph — any cycle
      // that routed through this component collapses. We build the "next"
      // components array inline (mirroring updateStatus) so recomputeCycles
      // sees the post-update graph without waiting for a render tick.
      const next = components.map((c, i) =>
        i === selectedIdx ? { ...c, status: 'rejected' as ReviewComponentStatus } : c,
      );
      setComponents(next);
      recomputeCycles(next);
      return;
    }
    if (input === 'A') {
      setComponents((prev) => prev.map((c) => (c.status === 'needs-review' ? { ...c, status: 'accepted' } : c)));
      setFinalizeError(null);
      return;
    }
    if (input === 'E') {
      // Expand every group root — the set of "every group root" is any
      // closure whose node count is >1 (i.e., roots with ≥1 descendant).
      const roots = new Set<string>();
      for (const [name, closure] of closures.entries()) {
        if (closure.nodes.length > 1) roots.add(name);
      }
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
        const nextOff = newRow >= off + VISIBLE_COUNT ? newRow - VISIBLE_COUNT + 1 : off;
        return { cursorRowIdx: newRow, sidebarScrollOffset: nextOff };
      });
      setJsonScrollOffset(0);
      setDraftValue('');
      setSaveError(null);
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

  const selected = components[selectedIdx] ?? null;
  const selectedJson = selected ? JSON.stringify({ [selected.key]: selected.entry }, null, 2) : '';

  const isEmpty = (c: CdfReviewEntry): boolean =>
    Object.keys(c.entry.$properties).length === 0 && Object.keys(c.entry.$slots ?? {}).length === 0;
  const emptyCount = components.filter(isEmpty).length;

  // INTEG-4401: cycle-participant set drives sidebar `(cycle)` badges plus
  // the banner counts. Recomputed on every render — cheap for typical N.
  const cycleParticipantSet = new Set<string>();
  for (const cycle of slotCycles) for (const p of cycle.path) cycleParticipantSet.add(p);

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
  // +5 = border (1) + badge column (1) + leading space (1) + trailing pad (1) + border (1).
  // The badge column is reserved even when no annotation is present so the
  // sidebar width doesn't jitter as live-preview annotations flip in/out.
  const sidebarWidth = Math.min(Math.max(longestName + 5, 14), 34);
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
      {showRemovedPanel && !dialogOpen && (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text bold color="cyan">{`Removed components (${removedComponents.length})`}</Text>
          <Text dimColor>these will be DELETED from the target space</Text>
          <Text> </Text>
          {removedComponents.map((rc) => (
            <Text key={rc.id}>{`- ${rc.name}${rc.id ? `  (${rc.id})` : ''}`}</Text>
          ))}
          <Text> </Text>
          <Text dimColor>press d or Esc to close</Text>
        </Box>
      )}
      {showCyclePanel &&
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
          lines.push(<Text key="cyc-space"> </Text>);
          slotCycles.forEach((cycle, idx) => {
            const nodeCount = new Set(cycle.path).size;
            lines.push(
              <Text
                key={`cyc-h-${idx}`}
                bold
              >{`▸ Cycle ${idx + 1} (${nodeCount} component${nodeCount === 1 ? '' : 's'}):`}</Text>,
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
              <Text dimColor>{'[↑↓/j/k] scroll  [c/q/Esc] close'}</Text>
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
              {removedComponents.length > 0 && <Text dimColor>{' ([d] removed list)'}</Text>}
              <Text>{' · '}</Text>
              <Text color="red" bold>
                {`${counts.breaking} breaking`}
              </Text>
            </Box>
          );
        })()}
      {!dialogOpen && slotCycles.length > 0 && !showCyclePanel && (
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
      {!dialogOpen && emptyCount > 0 && (
        <Text color="yellow">
          {`⚠ ${emptyCount} component${emptyCount === 1 ? '' : 's'} had no classifiable props — review with care`}
        </Text>
      )}
      {!dialogOpen && finalizeError && <Text color="red">{`⚠ ${finalizeError}`}</Text>}
      {!dialogOpen && searchOpen && (
        <Box>
          <Text>
            {`/${searchQuery}`}
            <Text color="cyan">{'▎'}</Text>
            {searchQuery && (
              <Text dimColor>{`  (${searchMatches.length}/${components.length} matches)`}</Text>
            )}
          </Text>
        </Box>
      )}
      {!dialogOpen && !searchOpen && searchQuery && (
        <Box>
          <Text dimColor>{`/${searchQuery}  (${searchMatches.length}/${components.length} matches) · [Esc] clear · [Tab] next`}</Text>
        </Box>
      )}
      {!dialogOpen && (
        <Box>
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
            scrollOffset={sidebarScrollOffset}
            visibleCount={VISIBLE_COUNT}
            dimPredicate={dimPredicate}
            visibleRows={visibleRowsMemo}
          />
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
                    {sidebarFocused ? '[e/Tab] focus panel' : '[Tab] focus list'}
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
                    key={selected.key}
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
                  />
                )}
                {saveError && <Text color="red">{'✗ ' + saveError}</Text>}
                <Text dimColor>
                  {sidebarFocused
                    ? '  [a] accept  [r] reject  [A] accept all  [J] ' +
                      (showJson ? 'hide JSON' : 'show JSON') +
                      '  [F] finalize  [e/Tab] focus panel' +
                      (closures.size > 0 ? '  [Space] expand/collapse  [E/C] expand/collapse all' : '') +
                      (livePreview && removedComponents.length > 0 ? '  [d] removed list' : '') +
                      (slotCycles.length > 0 ? '  [c] cycles' : '') +
                      '  [q] quit'
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

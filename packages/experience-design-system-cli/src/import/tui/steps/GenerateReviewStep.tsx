import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import type {
  CDFComponentEntry,
  ComponentTypeSummary,
  ServerPreviewResponse,
} from '@contentful/experience-design-system-types';
import { Sidebar } from '../../../analyze/select/tui/components/Sidebar.js';
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
  type ComponentReviewMetadata,
  type ComponentRationale,
} from '../../../session/db.js';
import { RationalePanel, type RationaleRow } from '../../../analyze/select/tui/components/RationalePanel.js';
import { ComponentRationalePanel } from '../../../analyze/select/tui/components/ComponentRationalePanel.js';
import type { FieldEditorMetadata } from '../../../analyze/select/tui/components/FieldEditor.js';
import type {
  PreviewAnnotation,
  ReviewComponentStatus,
  ReviewComponentSummary,
} from '../../../analyze/select/types.js';
import { applyPreviewAnnotations } from '../../../analyze/select/preview-annotations.js';
import { useLivePreview } from '../useLivePreview.js';
import { computeNextScrollOffset } from '../../../analyze/select/tui/hooks/scroll-offset.js';

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
): T[] {
  return [...components].sort((a, b) => {
    const aEmpty = Object.keys(a.entry.$properties ?? {}).length === 0;
    const bEmpty = Object.keys(b.entry.$properties ?? {}).length === 0;
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
}: GenerateReviewStepProps): React.ReactElement {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;

  const [components, setComponents] = useState<CdfReviewEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [sidebarScrollOffset, setSidebarScrollOffset] = useState(0);
  const [jsonScrollOffset, setJsonScrollOffset] = useState(0);
  const [sidebarFocused, setSidebarFocused] = useState(true);
  const [showFinalize, setShowFinalize] = useState(false);
  const [showQuit, setShowQuit] = useState(false);
  // FieldEditor is the default editor. JSON view is an opt-in read-only toggle.
  const [showJson, setShowJson] = useState(false);
  const [draftValue, setDraftValue] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
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
  const [panelOpen, setPanelOpen] = useState<'none' | 'prop-rationale' | 'component-rationale' | 'source'>(
    'none',
  );
  const [panelScrollOffset, setPanelScrollOffset] = useState(0);
  const [textEntryActive, setTextEntryActive] = useState(false);
  const [componentRationale, setComponentRationale] = useState<ComponentRationale | null>(null);
  // Tracks the first `g` of a potential `gg` double-tap (jumps to top in
  // JSON-view + panel-focused state). Reset on any non-`g` key.
  const pendingGRef = useRef(false);

  const handleLivePreviewResult = (response: ServerPreviewResponse | null): void => {
    if (!response) return;
    setPreviewAnnotations(applyPreviewAnnotations(response, components.map((c) => c.key)));
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
      try {
        cdfComponents = loadCDFComponents(db, extractSessionId);
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
      setComponents(sortComponentsForSidebar(reviewEntries));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

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

  const updateStatus = (idx: number, status: ReviewComponentStatus) => {
    setComponents((prev) => prev.map((c, i) => (i === idx ? { ...c, status } : c)));
  };

  const handleFinalizeConfirm = () => {
    // Strict opt-in: only EXPLICITLY ACCEPTED components ship. Anything left
    // in 'needs-review' OR explicitly 'rejected' is downgraded to
    // 'generate-rejected' so loadCDFComponents excludes it from the manifest.
    // The operator told us they want accept-to-ship semantics — leaving a
    // component unresolved should NOT silently push it (Pilot-2026-06-24 R2).
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
    const acceptedCount = components.filter((c) => c.status === 'accepted').length;
    onFinalize(acceptedCount, explicitlyRejected.length, unresolved.length);
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
      setComponents((prev) =>
        prev.map((c, i) =>
          i === selectedIdx ? { ...c, entry, status: c.status === 'needs-review' ? 'accepted' : c.status } : c,
        ),
      );
      setDraftValue('');
      setSaveError(null);
      const db = openPipelineDb();
      try {
        storeCDFComponents(db, extractSessionId, [{ key: current.key, entry }]);
      } finally {
        db.close();
      }
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
    // `d` opens the panel only when live-preview is enabled and there is at
    // least one removed component to display. Sidebar-focused only so it
    // doesn't collide with FieldEditor input.
    if (
      input === 'd' &&
      sidebarFocused &&
      livePreview &&
      removedComponents.length > 0
    ) {
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
      setSidebarFocused((prev) => !prev);
      return;
    }
    if (input === 'e' && sidebarFocused) {
      setSidebarFocused(false);
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
    if (input === 'q') {
      setShowQuit(true);
      return;
    }
    if (input === 'F') {
      setShowFinalize(true);
      return;
    }
    if (input === 'a') {
      updateStatus(selectedIdx, 'accepted');
      return;
    }
    if (input === 'r') {
      updateStatus(selectedIdx, 'rejected');
      return;
    }
    if (input === 'A') {
      setComponents((prev) => prev.map((c) => (c.status === 'needs-review' ? { ...c, status: 'accepted' } : c)));
      return;
    }
    if (input === 'J') {
      // Toggle read-only JSON view.
      setShowJson((prev) => !prev);
      setJsonScrollOffset(0);
      pendingGRef.current = false;
      return;
    }

    if (key.upArrow || input === 'k') {
      // Pilot-2026-06-23 bug: rapid k/j bursts could lose cursor position
      // because the previous implementation read `selectedIdx` from the
      // handler's closure. Under high keyboard-repeat rate multiple key
      // events fire between Ink render flushes, so every invocation saw the
      // same stale value and recomputed the same `newIdx`. Using functional
      // setState chains the updates correctly: each pending update sees the
      // post-update value of the previous one. The viewport offset update is
      // nested inside the cursor updater so it always reflects the same
      // newIdx that selectedIdx is being set to.
      setSelectedIdx((prev) => {
        const newIdx = Math.max(0, prev - 1);
        setSidebarScrollOffset((off) => Math.min(off, newIdx));
        return newIdx;
      });
      setJsonScrollOffset(0);
      setDraftValue('');
      setSaveError(null);
    } else if (key.downArrow || input === 'j') {
      setSelectedIdx((prev) => {
        const newIdx = Math.min(components.length - 1, prev + 1);
        setSidebarScrollOffset((off) => (newIdx >= off + VISIBLE_COUNT ? newIdx - VISIBLE_COUNT + 1 : off));
        return newIdx;
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

  // A component with zero classified $properties is a real defensibility issue —
  // it can't be pushed to Contentful (no fields). Surface it in the sidebar via
  // the existing warning-color path (yellow) and a "(empty)" suffix so the user
  // can see what went wrong. They can manually add props in FieldEditor or
  // explicitly reject the component.
  const isEmpty = (c: CdfReviewEntry): boolean => Object.keys(c.entry.$properties).length === 0;
  const emptyCount = components.filter(isEmpty).length;

  const sidebarItems: ReviewComponentSummary[] = components.map((c) => ({
    id: c.key,
    name: isEmpty(c) ? `${c.key} (empty)` : c.key,
    status: c.status,
    previewAnnotation: previewAnnotations.get(c.key),
    extractionConfidence: null,
    needsReview: false,
    validationErrorCount: 0,
    validationWarningCount: isEmpty(c) ? 1 : 0,
  }));

  // Account for the "(empty)" suffix added to zero-prop component names so the
  // sidebar doesn't truncate it.
  const longestName = components.reduce(
    (m, c) => Math.max(m, c.key.length + (isEmpty(c) ? ' (empty)'.length : 0)),
    0,
  );
  // +5 = border (1) + status icon (1) + badge column (1) + space (1) + border (1).
  // The badge column is reserved even when no annotation is present so the
  // sidebar width doesn't jitter as live-preview annotations flip in/out.
  const sidebarWidth = Math.min(Math.max(longestName + 5, 14), 30);
  const panelWidth = Math.max(10, terminalWidth - sidebarWidth - 4);

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
      {!dialogOpen && livePreview && (() => {
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
            {removedComponents.length > 0 && (
              <Text dimColor>{' ([d] removed list)'}</Text>
            )}
            <Text>{' · '}</Text>
            <Text color="red" bold>
              {`${counts.breaking} breaking`}
            </Text>
          </Box>
        );
      })()}
      {!dialogOpen && emptyCount > 0 && (
        <Text color="yellow">
          {`⚠ ${emptyCount} component${emptyCount === 1 ? '' : 's'} had no classifiable props — review with care`}
        </Text>
      )}
      {!dialogOpen && (
        <Box>
          <Sidebar
            components={sidebarItems}
            selectedId={selected?.key ?? null}
            focused={sidebarFocused}
            scrollOffset={sidebarScrollOffset}
            visibleCount={VISIBLE_COUNT}
            onSelect={(id) => {
              const idx = components.findIndex((c) => c.key === id);
              if (idx >= 0) {
                setSelectedIdx(idx);
                setJsonScrollOffset(0);
              }
            }}
            onScrollChange={setSidebarScrollOffset}
            width={sidebarWidth}
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
                      <Box flexDirection="column" width={panelWidth} borderStyle="single" borderColor="gray" paddingX={1}>
                        <Text dimColor bold>{`source: ${headerPath}`}</Text>
                        {src
                          ? lines.map((ln, i) => (
                              <Text key={`source-line-${i}`} dimColor>
                                {ln}
                              </Text>
                            ))
                          : <Text dimColor>{'(no source captured)'}</Text>}
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
                  />
                )}
                {saveError && <Text color="red">{'✗ ' + saveError}</Text>}
                <Text dimColor>
                  {sidebarFocused
                    ? '  [a] accept  [r] reject  [A] accept all  [J] ' +
                      (showJson ? 'hide JSON' : 'show JSON') +
                      '  [F] finalize  [e/Tab] focus panel' +
                      (livePreview && removedComponents.length > 0 ? '  [d] removed list' : '') +
                      '  [q] quit'
                    : showJson
                      ? '  [j/k] scroll  [Ctrl+u/d] half-page  [gg/G] top/bottom  [Tab] focus list'
                      : '  [Tab] focus list  (edit fields)'}
                  {livePreviewHook.status === 'running' && (
                    <Text>{`  ${livePreviewSpinner} live preview`}</Text>
                  )}
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

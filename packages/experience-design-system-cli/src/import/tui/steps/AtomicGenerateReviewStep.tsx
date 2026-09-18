import React, { useCallback, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { Sidebar } from '../../../analyze/select/tui/components/Sidebar.js';
import { StatusBar } from '../../../analyze/select/tui/components/StatusBar.js';
import { FinalizeDialog } from '../../../analyze/select/tui/components/FinalizeDialog.js';
import { QuitDialog } from '../../../analyze/select/tui/components/QuitDialog.js';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';
import type { ReviewComponentStatus, ReviewComponentSummary } from '../../../analyze/select/types.js';
import type { HistorySnapshot } from '../history.js';
import { useFinalizePreview } from '../useFinalizePreview.js';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { getReviewJsonPanelValue } from './review-json-panel.js';
import { ReviewDetailsEditor } from '../components/ReviewDetailsEditor.js';
import { LivePreviewSummary } from '../components/LivePreviewSummary.js';
import { countReviewStatuses, ReviewLoadError, ReviewLoadingState } from '../components/ReviewStatus.js';
import {
  handleJsonPanelInput,
  handleRationalePanelInput,
  handleReviewOverlayInput,
  handleTokenReviewInput,
} from '../hooks/review-input.js';
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
import { useReviewPreview } from '../hooks/useReviewPreview.js';

type GenerateReviewStepProps = {
  extractSessionId: string;
  tokenSessionId?: string | null;
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
function sortComponentsForSidebar<T extends { key: string; entry: CDFComponentEntry }>(components: T[]): T[] {
  return [...components].sort((a, b) => {
    const aEmpty = Object.keys(a.entry.$properties ?? {}).length === 0;
    const bEmpty = Object.keys(b.entry.$properties ?? {}).length === 0;
    if (aEmpty !== bEmpty) return aEmpty ? -1 : 1;
    return a.key.localeCompare(b.key);
  });
}

const VISIBLE_COUNT = 20;
const PANEL_HEIGHT = 22;

export function AtomicGenerateReviewStep({
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
}: GenerateReviewStepProps): React.ReactElement {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;

  const loadSessionState = useCallback(
    (): ReviewSessionLoadResult =>
      loadReviewSessionState({
        extractSessionId,
        tokenSessionId,
        sortEntries: (entries) => sortComponentsForSidebar(entries),
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
  });

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [sidebarScrollOffset, setSidebarScrollOffset] = useState(0);
  const [sidebarFocused, setSidebarFocused] = useState(true);
  const [showFinalize, setShowFinalize] = useState(false);
  const [showQuit, setShowQuit] = useState(false);
  // INTEG-4411: inline banner shown when the operator tries to finalize
  // with zero accepted components. Cleared on the next 'a' or 'A' press.
  const [finalizeError, setFinalizeError] = useState<string | null>(initialFinalizeError);
  // Feature 1: per-component review metadata (rationale + source location)
  // for the currently-selected component. Reloaded when selection changes.
  // Pilot-2026-06-24: raw removed list for the `d` detail panel. The
  // annotation map only carries kind, not the rich summaries we need to list
  // names/ids when the operator asks "which ones?".
  const [showRemovedPanel, setShowRemovedPanel] = useState(false);
  const [showReloadDialog, setShowReloadDialog] = useState(false);

  const applyHistorySnapshot = (snapshot: HistorySnapshot): void => {
    setComponents(
      snapshot.components.map((component) => ({
        key: component.key,
        entry: component.entry,
        status: component.status,
      })),
    );
  };
  const { pushHistorySnapshot, handleUndo, handleRedo, resetHistory } = useReviewHistory({
    loading,
    components,
    createSnapshot: (entries) => createReviewHistorySnapshot(entries),
    applySnapshot: applyHistorySnapshot,
  });

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
  });

  const reviewEditor = useReviewEditor({
    components,
    selectedIdx,
    extractSessionId,
    availableTokens,
    setComponents,
    pushHistorySnapshot,
    onEditSaved: () => livePreviewHook.trigger(),
    onTokenSaved: () => livePreviewHook.trigger(),
  });

  const {
    panelOpen,
    setPanelOpen,
    panelScrollOffset,
    setPanelScrollOffset,
    jsonScrollOffset,
    setJsonScrollOffset,
    textEntryActive,
    setTextEntryActive,
    showJson,
    setShowJson,
    showHiddenProps,
    setShowHiddenProps,
    draftValue,
    setDraftValue,
    saveError,
    setSaveError,
    tokenReviewRow,
    setTokenReviewRow,
    tokenReviewEditing,
    tokenReviewEditCursor,
    tokenReviewEditSelection,
    pendingGRef,
    currentTokenSuggestions,
    handleEditSave,
    handleEditDiscard,
  } = reviewEditor;

  const reloadFromSave = (): void => {
    const result = reloadSessionFromSave();
    if (!result) return;
    resetHistory(createReviewHistorySnapshot(result.entries));
  };

  const { reviewMetadata, componentRationale } = useReviewMetadata({
    components,
    selectedIdx,
    extractSessionId,
  });

  const updateStatus = (idx: number, status: ReviewComponentStatus) => {
    setComponents((prev) => {
      const next = prev.map((c, i) => (i === idx ? { ...c, status } : c));
      pushHistorySnapshot(next, `status:${status}`);
      return next;
    });
  };

  const acceptAll = (): void => {
    setComponents((prev) => {
      const next: CdfReviewEntry[] = prev.map((c) => (c.status === 'needs-review' ? { ...c, status: 'accepted' } : c));
      pushHistorySnapshot(next, 'accept-all');
      return next;
    });
  };

  const finalizePreview = useFinalizePreview({
    open: showFinalize,
    extractSessionId,
    tokensPath,
    spaceId,
    environmentId,
    cmaToken,
    host,
    acceptedKeys: new Set(components.filter((c) => c.status === 'accepted').map((c) => c.key)),
  });

  const handleFinalizeConfirm = () => {
    const counts = finalizeReviewSession(extractSessionId, components);
    onFinalize(counts.accepted, counts.rejected, counts.unresolved);
  };

  const dialogOpen = showFinalize || showQuit;

  useImmediateInput((input, key) => {
    if (
      handleReviewOverlayInput(input, key, {
        loading,
        loadError,
        showFinalize,
        dialogOpen,
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
    if (input === 'd' && sidebarFocused && livePreview && removedComponents.length > 0) {
      setShowRemovedPanel(true);
      return;
    }

    if (handleTokenReviewInput(input, key, reviewEditor)) return;

    // Lifted rationale + source panels: i/I/s fire from anywhere (sidebar OR
    // panel focus). Gated against text-entry surfaces inside FieldEditor
    // (description editors, string-default editor, value-list text entry)
    // via the `onTextEntryActiveChange` callback, plus the help/finalize/quit
    // overlays and the JSON view.
    if (handleRationalePanelInput(input, key, { ...reviewEditor, propKey: 'i', componentKey: 'I' })) return;
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
      if (input === 's') {
        setPanelOpen('source');
        setPanelScrollOffset(() => 0);
        return;
      }
      if (input === 't' && currentTokenSuggestions().length > 0) {
        setPanelOpen('token-review');
        setTokenReviewRow(0);
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

    // JSON view + panel focused: own j/k/arrows/PageUp/PageDown/Ctrl+u/d/gg/G for scrolling.
    const current = components[selectedIdx];
    if (
      handleJsonPanelInput(input, key, {
        ...reviewEditor,
        sidebarFocused,
        showJson,
        jsonValue: getReviewJsonPanelValue(current ?? null, showHiddenProps),
        height: PANEL_HEIGHT,
      })
    )
      return;

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
      setFinalizeError(null);
      return;
    }
    if (input === 'r') {
      updateStatus(selectedIdx, 'rejected');
      return;
    }
    if (input === 'A') {
      acceptAll();
      setFinalizeError(null);
      return;
    }
    if (input === 'J') {
      // Toggle read-only JSON view.
      setShowJson((prev) => !prev);
      setJsonScrollOffset(0);
      pendingGRef.current = false;
      return;
    }
    if (input === 'H') {
      setShowHiddenProps((prev) => !prev);
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
    return <ReviewLoadingState />;
  }

  if (loadError) {
    return <ReviewLoadError message={loadError} />;
  }

  const selected = components[selectedIdx] ?? null;
  const selectedJson = selected ? JSON.stringify({ [selected.key]: selected.entry }, null, 2) : '';
  const visibleJsonPanelValue = getReviewJsonPanelValue(selected, showHiddenProps);

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
  const longestName = components.reduce((m, c) => Math.max(m, c.key.length + (isEmpty(c) ? ' (empty)'.length : 0)), 0);
  // +5 = border (1) + status icon (1) + badge column (1) + space (1) + border (1).
  // The badge column is reserved even when no annotation is present so the
  // sidebar width doesn't jitter as live-preview annotations flip in/out.
  const sidebarWidth = Math.min(Math.max(longestName + 5, 14), 30);
  const panelWidth = Math.max(10, terminalWidth - sidebarWidth - 4);

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
      {showRemovedPanel && !dialogOpen && (
        <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.info} paddingX={1}>
          <Text bold color={PALETTE.info}>{`Removed components (${removedComponents.length})`}</Text>
          <Text dimColor>these will be DELETED from the target space</Text>
          <Text> </Text>
          {removedComponents.map((rc) => (
            <Text key={rc.id}>{`- ${rc.name}${rc.id ? `  (${rc.id})` : ''}`}</Text>
          ))}
          <Text> </Text>
          <Text dimColor>press d or Esc to close</Text>
        </Box>
      )}
      {!dialogOpen && (
        <LivePreviewSummary
          enabled={livePreview}
          previewAnnotations={previewAnnotations}
          status={livePreviewHook.status}
          disabled={livePreviewHook.disabled}
          spinner={livePreviewSpinner}
          removedCount={removedComponents.length}
          showRemovedListHint
        />
      )}
      {!dialogOpen && emptyCount > 0 && (
        <Text color={PALETTE.warning}>
          {`⚠ ${emptyCount} component${emptyCount === 1 ? '' : 's'} had no classifiable props — review with care`}
        </Text>
      )}
      {!dialogOpen && finalizeError && <Text color={PALETTE.error}>{`⚠ ${finalizeError}`}</Text>}
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
                <ReviewDetailsEditor
                  selectedKey={selected.key}
                  panelOpen={panelOpen}
                  componentRationale={componentRationale}
                  reviewMetadata={reviewMetadata}
                  panelScrollOffset={panelScrollOffset}
                  width={panelWidth}
                  height={PANEL_HEIGHT}
                  sourceBorderColor={PALETTE.border}
                  tokenSuggestions={currentTokenSuggestions()}
                  tokenReviewRow={tokenReviewRow}
                  tokenReviewEditing={tokenReviewEditing}
                  tokenReviewEditCursor={tokenReviewEditCursor}
                  tokenReviewEditSelection={tokenReviewEditSelection}
                  showJson={showJson}
                  jsonValue={visibleJsonPanelValue}
                  jsonScrollOffset={jsonScrollOffset}
                  sidebarFocused={sidebarFocused}
                  fieldEditor={{
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
                    onToggleComponentRationale: () => {
                      setPanelOpen('component-rationale');
                      setPanelScrollOffset(() => 0);
                    },
                    onToggleSourceExternal: () => {
                      setPanelOpen('source');
                      setPanelScrollOffset(() => 0);
                    },
                    onTextEntryActiveChange: setTextEntryActive,
                    initialFocusTarget: { kind: 'description' },
                  }}
                />
                {saveError && <Text color={PALETTE.error}>{'✗ ' + saveError}</Text>}
                <Text dimColor>
                  {panelOpen === 'token-review'
                    ? '  [↑/↓] move  [Enter] edit allowed  [Esc] close'
                    : sidebarFocused
                      ? '  [a] accept  [r] reject  [A] accept all  [i] prop rationale  [I] component rationale  [s] source  [J] ' +
                        (showJson ? 'hide JSON' : 'show JSON') +
                        '  [H] ' +
                        (showHiddenProps ? 'hide state/unattached' : 'show state/unattached') +
                        (currentTokenSuggestions().length > 0 ? '  [t] token review' : '') +
                        '  [^z] undo  [^y] redo  [^r] reload  [F] finalize  [e/Tab] focus panel' +
                        (livePreview && removedComponents.length > 0 ? '  [d] removed list' : '') +
                        '  [q] quit'
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
      {!dialogOpen && (
        <StatusBar
          accepted={accepted}
          rejected={rejected}
          reviewed={0}
          needsReview={needsReview}
          onApproveAll={acceptAll}
          onFinalize={() => setShowFinalize(true)}
        />
      )}
    </Box>
  );
}

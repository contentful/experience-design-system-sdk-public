import React, { useEffect, useReducer, useRef } from 'react';
import { Box, Text, useStdout } from 'ink';
import { readFile } from 'node:fs/promises';
import type { ReviewComponentStatus } from '../types.js';
import { createReviewSessionDetail } from '../types.js';
import { TopBar } from './components/TopBar.js';
import { Sidebar } from './components/Sidebar.js';
import { ComponentDetail } from './components/ComponentDetail.js';
import { StatusBar } from './components/StatusBar.js';
import { HelpOverlay } from './components/HelpOverlay.js';
import { FinalizeDialog } from './components/FinalizeDialog.js';
import { QuitDialog } from './components/QuitDialog.js';
import { PreviewSummaryBar } from './components/PreviewSummaryBar.js';
import { useImmediateInput } from './hooks/useImmediateInput.js';
import { useRawMode } from './hooks/useRawMode.js';
import { useSession } from './hooks/useSession.js';
import { reducer, initialState } from './state.js';
import { inputToAction } from './inputToAction.js';
import { openPipelineDb, storeRawComponents, loadCDFComponents } from '../../../session/db.js';
import { ImportApiClient } from '../../../apply/api-client.js';
import { readTokensFromPath } from '../../../apply/manifest.js';
import { buildManifest } from '@contentful/experience-design-system-types';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';

type AppProps = {
  sessionId: string;
  artifactsRoot: string;
  reviewRoot?: string;
};

export function App({ sessionId, artifactsRoot, reviewRoot }: AppProps): React.ReactElement {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;
  const visibleCount = Math.max(1, (stdout?.rows ?? 24) - 5);

  useRawMode();

  const {
    session: loadedSession,
    paths,
    loading,
    error: sessionError,
    saveState,
    appendEvent,
  } = useSession({
    sessionId,
    artifactsRoot,
    reviewRoot,
  });

  const [state, dispatch] = useReducer(reducer, initialState);

  // Keep a ref to the latest state so the single stdin listener always reads
  // committed values — avoids stale closure since the listener is registered once.
  const stateRef = useRef(state);
  const visibleCountRef = useRef(visibleCount);
  const terminalWidthRef = useRef(terminalWidth);
  stateRef.current = state;
  visibleCountRef.current = visibleCount;
  terminalWidthRef.current = terminalWidth;

  // ── Single stdin listener — the entire input model ────────────────────────
  useImmediateInput((input, key) => {
    const action = inputToAction(input, key, stateRef.current, visibleCountRef.current, terminalWidthRef.current);
    if (action) dispatch(action);
    // When mode=editing, inputToAction returns null for text/arrow keys so
    // JsonEditor's own listener handles cursor movement unimpeded.
  });

  // ── Load session into reducer ─────────────────────────────────────────────
  useEffect(() => {
    if (loadedSession && !state.session) {
      dispatch({ type: 'SESSION_LOADED', session: loadedSession, paths });
    }
  }, [loadedSession]);

  // ── SIGINT ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => {
      if (Object.keys(state.draftsByComponentId).length > 0) {
        dispatch({ type: 'OPEN_DIALOG', which: 'quit' });
      } else {
        process.exit(1);
      }
    };
    process.on('SIGINT', handler);
    return () => {
      process.off('SIGINT', handler);
    };
  }, [state.draftsByComponentId]);

  // ── Quit confirm side-effect ──────────────────────────────────────────────
  useEffect(() => {
    if (state.mode.type !== 'dialog' || state.mode.which !== 'quit') return;
    // handled by QUIT_CONFIRM action — actual exit triggered when reducer
    // returns QUIT_CONFIRM; we need to watch for that transition
  }, [state.mode]);

  // Watch for QUIT_CONFIRM — exit and log event
  const prevModeRef = useRef(state.mode);
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = state.mode;
    if (prev.type === 'dialog' && prev.which === 'quit' && state.mode.type !== 'dialog') {
      // CLOSE_DIALOG was dispatched (cancel), nothing to do
    }
  }, [state.mode]);

  // ── Persist session on status changes (accept/reject/approve-all) ────────
  useEffect(() => {
    if (!state.session || !paths || state.pendingSessionSave === 0) return;
    void saveState(state.session);
  }, [state.pendingSessionSave]);

  // ── Save draft side-effect ────────────────────────────────────────────────
  useEffect(() => {
    if (!state.pendingDraftSave || !state.session || !paths) return;
    const componentId = state.pendingDraftSave;
    const draft = state.draftsByComponentId[componentId];
    if (!draft) {
      dispatch({ type: 'DRAFT_PERSIST_DONE', componentId, updatedComponents: state.session.components });
      return;
    }
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsed = JSON.parse(draft) as Record<string, any>;
        const component = state.session!.components.find((c) => c.id === componentId);
        const currentStatus = component?.status;
        const newStatus: ReviewComponentStatus =
          currentStatus === 'needs-review' ? 'reviewed' : (currentStatus ?? 'reviewed');

        const updatedComponents = state.session!.components.map((c) =>
          c.id === componentId ? { ...c, editedProposal: parsed as typeof c.editedProposal, status: newStatus } : c,
        );

        await saveState({ ...state.session!, components: updatedComponents });
        await appendEvent({ type: 'draft_saved', payload: { componentId } });

        const db = openPipelineDb();
        try {
          storeRawComponents(
            db,
            sessionId,
            updatedComponents.map((c) => c.editedProposal),
            {
              status: 'generated',
              preserveCDF: true,
            },
          );
        } finally {
          db.close();
        }

        dispatch({ type: 'DRAFT_PERSIST_DONE', componentId, updatedComponents });
      } catch {
        // JSON parse error — JsonEditor shows the error inline; just clear pending
        dispatch({ type: 'DRAFT_PERSIST_DONE', componentId, updatedComponents: state.session!.components });
      }
    })();
  }, [state.pendingDraftSave]);

  // ── Finalize side-effect ──────────────────────────────────────────────────
  useEffect(() => {
    if (state.mode.type !== 'finalized' || !state.session || !paths) return;
    const { accepted, rejected, excluded } = state.mode;
    void (async () => {
      try {
        await appendEvent({ type: 'finalized', payload: { accepted, rejected, excluded } });

        const acceptedNames = new Set(
          state.session!.components.filter((c) => c.status === 'accepted').map((c) => c.name),
        );
        const db = openPipelineDb();
        try {
          storeRawComponents(
            db,
            sessionId,
            state.session!.components.map((c) => c.editedProposal),
            {
              status: 'extracted',
              preserveCDF: true,
            },
          );
          if (acceptedNames.size > 0) {
            db.prepare(
              `UPDATE raw_components SET status = 'generated' WHERE session_id = ? AND name IN (${[...acceptedNames].map(() => '?').join(',')})`,
            ).run(sessionId, ...acceptedNames);
          }
        } finally {
          db.close();
        }

        process.stdout.write(
          JSON.stringify({ status: 'finalized', sessionDir: paths.sessionDir, accepted, rejected, excluded }, null, 2) +
            '\n',
        );
      } catch (err) {
        dispatch({ type: 'SAVE_ERROR', message: String(err) });
      }
    })();
  }, [state.mode.type === 'finalized']);

  // ── Lazy source code loading ──────────────────────────────────────────────
  useEffect(() => {
    if (!state.selectedId || !state.session) return;
    if (state.sourceCodeById[state.selectedId] !== undefined) return;
    const component = state.session.components.find((c) => c.id === state.selectedId);
    if (!component) return;
    readFile(component.resolvedSourcePath, 'utf8')
      .then((code) => dispatch({ type: 'SOURCE_LOADED', componentId: state.selectedId!, code }))
      .catch(() => dispatch({ type: 'SOURCE_LOADED', componentId: state.selectedId!, code: '' }));
  }, [state.selectedId]);

  // ── Preview refresh (debounced) ───────────────────────────────────────────
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!state.session || state.pendingPreviewRefresh === 0) return;

    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    previewDebounceRef.current = setTimeout(() => {
      // Sync session to DB first
      const db = openPipelineDb();
      try {
        db.prepare(`UPDATE raw_components SET status = 'extracted' WHERE session_id = ?`).run(sessionId);
        const acceptedNames = state
          .session!.components.filter((c) => c.status === 'accepted' || c.status === 'reviewed')
          .map((c) => c.name);
        if (acceptedNames.length > 0) {
          db.prepare(
            `UPDATE raw_components SET status = 'generated' WHERE session_id = ? AND name IN (${acceptedNames.map(() => '?').join(',')})`,
          ).run(sessionId, ...acceptedNames);
        }
      } finally {
        db.close();
      }

      // Then refresh preview
      const cmaToken = process.env['EDS_CMA_TOKEN'];
      const spaceId = process.env['EDS_SPACE_ID'];
      const environmentId = process.env['EDS_ENVIRONMENT_ID'];
      const tokensPath = process.env['EDS_TOKENS_PATH'];
      if (!cmaToken || !spaceId || !environmentId) return;

      dispatch({ type: 'PREVIEW_START' });
      void (async () => {
        try {
          const pdb = openPipelineDb();
          let components: Array<{ key: string; entry: unknown }> = [];
          try {
            components = loadCDFComponents(pdb, sessionId);
          } finally {
            pdb.close();
          }
          let tokens: unknown[] = [];
          if (tokensPath) tokens = await readTokensFromPath('tokens', tokensPath);
          const manifest = buildManifest(
            components as Parameters<typeof buildManifest>[0],
            tokens as Parameters<typeof buildManifest>[1],
          );
          if (!manifest.componentsManifest) manifest.componentsManifest = {};
          const client = new ImportApiClient({ cmaToken, spaceId, environmentId });
          const preview: ServerPreviewResponse = await client.previewImport(manifest);

          const annotations: Record<string, import('../types.js').PreviewAnnotation> = {};
          for (const item of preview.components.new) {
            const name = ((item as unknown as Record<string, unknown>).name as string) ?? '';
            if (name) annotations[name] = 'new';
          }
          for (const item of preview.components.removed) annotations[item.name] = 'removed';
          for (const item of preview.components.changed) {
            annotations[item.current.name] =
              item.changeClassification?.classification === 'breaking' ? 'breaking' : 'changed';
          }
          dispatch({ type: 'PREVIEW_SUCCESS', response: preview, annotations });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          dispatch({ type: 'PREVIEW_ERROR', message: msg.includes('token') ? 'Preview request failed' : msg });
        }
      })();
    }, 500);

    return () => {
      if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    };
  }, [state.pendingPreviewRefresh]);

  // ── Seed preview from env (non-live mode) ─────────────────────────────────
  useEffect(() => {
    if (!state.session || state.previewResponse) return;
    const raw = process.env['EDS_PREVIEW_COUNTS'];
    if (!raw) return;
    try {
      const counts = JSON.parse(raw) as Record<string, number>;
      const make = (n: number) => Array(n).fill({}) as unknown[];
      dispatch({
        type: 'PREVIEW_SUCCESS',
        response: {
          components: {
            new: make(counts.compNew ?? 0),
            changed: make(counts.compChanged ?? 0),
            removed: make(counts.compRemoved ?? 0),
            unchanged: make(counts.compUnchanged ?? 0),
          },
          tokens: {
            new: make(counts.tokNew ?? 0),
            changed: make(counts.tokChanged ?? 0),
            removed: make(counts.tokRemoved ?? 0),
            unchanged: make(counts.tokUnchanged ?? 0),
          },
        } as unknown as ServerPreviewResponse,
        annotations: {},
      });
    } catch {}
  }, [state.session]);

  // ── Auto-clear save error ─────────────────────────────────────────────────
  useEffect(() => {
    if (!state.saveError) return;
    const t = setTimeout(() => dispatch({ type: 'CLEAR_ERRORS' }), 3000);
    return () => clearTimeout(t);
  }, [state.saveError]);

  // ── Derived render values ─────────────────────────────────────────────────
  if (loading) return <Text>Loading session...</Text>;
  if (sessionError)
    return (
      <Text color="red">
        {sessionError}
        {'\nPress q to exit.'}
      </Text>
    );
  if (!state.session) return <Text color="red">Session unavailable.</Text>;

  const { mode, session, selectedId, sidebarScrollOffset, jsonScrollOffset } = state;

  if (mode.type === 'finalized') return <FinalizedScreen result={mode} />;

  const selectedRecord = session.components.find((c) => c.id === selectedId) ?? null;
  const sessionDetail = selectedRecord ? createReviewSessionDetail({ ...session, components: [selectedRecord] }) : null;
  const selectedDetail = sessionDetail?.components[0] ?? null;

  const acceptedCount = session.components.filter((c) => c.status === 'accepted').length;
  const rejectedCount = session.components.filter((c) => c.status === 'rejected').length;
  const reviewedCount = session.components.filter((c) => c.status === 'reviewed').length;
  const needsReviewCount = session.components.filter((c) => c.status === 'needs-review').length;

  const dialogOpen = mode.type === 'dialog';
  const isEditing = mode.type === 'editing';
  const sourceVisible = mode.type === 'browsing' && mode.sourceVisible;
  const sidebarFocused = mode.type === 'browsing' && mode.sidebarFocused;

  const hints = isEditing
    ? [
        { key: 'Ctrl+S', label: 'save' },
        { key: 'Esc', label: 'discard' },
      ]
    : dialogOpen
      ? []
      : [
          { key: '?', label: 'help' },
          { key: 'q', label: 'quit' },
        ];

  const collapsed = terminalWidth < 80;
  const longestName = session.components.reduce((max, c) => Math.max(max, c.name.length), 0);
  const sidebarWidth = collapsed ? 3 : Math.min(Math.max(longestName + 4, 14), 22);

  const sessionSummary = state.sortedIds
    .map((id) => session.components.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => ({
      id: c!.id,
      name: c!.name,
      status: c!.status,
      previewAnnotation: state.previewAnnotations[c!.name] as import('../types.js').PreviewAnnotation | undefined,
      extractionConfidence: c!.originalProposal.extractionConfidence ?? null,
      needsReview: c!.originalProposal.needsReview ?? false,
    }));

  return (
    <Box flexDirection="column">
      <TopBar subcommand="analyze select" hints={hints} />

      {mode.type === 'dialog' && mode.which === 'help' && (
        <HelpOverlay mode="review" onClose={() => dispatch({ type: 'CLOSE_DIALOG' })} />
      )}
      {mode.type === 'dialog' && mode.which === 'finalize' && (
        <FinalizeDialog
          accepted={acceptedCount}
          rejected={rejectedCount}
          needsReview={needsReviewCount}
          onConfirm={() => dispatch({ type: 'FINALIZE_CONFIRM' })}
          onCancel={() => dispatch({ type: 'CLOSE_DIALOG' })}
        />
      )}
      {mode.type === 'dialog' && mode.which === 'quit' && (
        <QuitDialog
          hasUnsavedDrafts={Object.keys(state.draftsByComponentId).length > 0}
          onConfirm={async () => {
            if (paths) await appendEvent({ type: 'session_quit', payload: { reason: 'user_quit' } });
            process.exit(1);
          }}
          onCancel={() => dispatch({ type: 'CLOSE_DIALOG' })}
        />
      )}

      {!dialogOpen && (
        <Box flexGrow={1}>
          <Sidebar
            components={sessionSummary}
            selectedId={selectedId}
            focused={sidebarFocused}
            scrollOffset={sidebarScrollOffset}
            visibleCount={visibleCount}
            onSelect={(id) => dispatch({ type: 'SELECT', id })}
            onScrollChange={(offset) => dispatch({ type: 'SELECT', id: state.sortedIds[offset] ?? state.selectedId! })}
            collapsed={collapsed}
            width={sidebarWidth}
          />
          <Box flexGrow={1} paddingLeft={1}>
            {selectedDetail ? (
              <ComponentDetail
                component={selectedDetail}
                sourceCode={selectedId ? (state.sourceCodeById[selectedId] ?? null) : null}
                draftValue={selectedId ? (state.draftsByComponentId[selectedId] ?? '') : ''}
                editMode={isEditing}
                sourceVisible={sourceVisible}
                jsonScrollOffset={jsonScrollOffset}
                sourceScrollX={0}
                sourceScrollY={0}
                terminalWidth={terminalWidth}
                previewAnnotation={
                  selectedRecord
                    ? (state.previewAnnotations[selectedRecord.name] as
                        | import('../types.js').PreviewAnnotation
                        | undefined)
                    : undefined
                }
                onDraftChange={(value) => dispatch({ type: 'DRAFT_CHANGE', value })}
                onSaveDraft={() => dispatch({ type: 'DRAFT_SAVE' })}
                onDiscardDraft={() => dispatch({ type: 'DRAFT_DISCARD' })}
                onScrollChange={(_offset) => dispatch({ type: 'SCROLL_UP' })}
              />
            ) : (
              <Text dimColor>No component selected</Text>
            )}
          </Box>
        </Box>
      )}

      <PreviewSummaryBar preview={state.previewResponse} loading={state.previewLoading} />
      {state.previewError && <Text color="yellow">{'⚠ Preview: ' + state.previewError}</Text>}
      {state.saveError && <Text color="red">{'⚠ ' + state.saveError}</Text>}

      {!dialogOpen && (
        <StatusBar
          accepted={acceptedCount}
          rejected={rejectedCount}
          reviewed={reviewedCount}
          needsReview={needsReviewCount}
        />
      )}
    </Box>
  );
}

function FinalizedScreen({
  result,
}: {
  result: { accepted: number; rejected: number; excluded: number };
}): React.ReactElement {
  useImmediateInput((_input, key) => {
    if (key.return || _input === 'q' || key.escape) process.exit(0);
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
      <Text bold color="green">
        ✓ Finalized
      </Text>
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color="green">✓</Text>
          <Text>{result.accepted} accepted</Text>
        </Box>
        {result.rejected > 0 && (
          <Box gap={1}>
            <Text color="red">✗</Text>
            <Text>{result.rejected} rejected</Text>
          </Box>
        )}
        {result.excluded > 0 && (
          <Box gap={1}>
            <Text dimColor>·</Text>
            <Text dimColor>{result.excluded} excluded (unresolved)</Text>
          </Box>
        )}
      </Box>
      <Text dimColor>Decisions saved. Ready for the next step.</Text>
      <Box marginTop={1}>
        <Text dimColor>[Enter / q] Exit</Text>
      </Box>
    </Box>
  );
}

import React, { useEffect, useReducer, useRef } from 'react';
import { Box, Text, useStdout } from 'ink';
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
import { useSideEffects } from './hooks/useSideEffects.js';
import { reducer, initialState } from './state.js';
import { inputToAction } from './inputToAction.js';
import { createReviewSessionDetail } from '../types.js';

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

  // Refs so the single stdin listener always reads the latest committed values
  const stateRef = useRef(state);
  const visibleCountRef = useRef(visibleCount);
  const terminalWidthRef = useRef(terminalWidth);
  stateRef.current = state;
  visibleCountRef.current = visibleCount;
  terminalWidthRef.current = terminalWidth;

  // ── Single stdin listener ─────────────────────────────────────────────────
  useImmediateInput((input, key) => {
    const action = inputToAction(input, key, stateRef.current, visibleCountRef.current, terminalWidthRef.current);
    if (action) dispatch(action);
  });

  // ── Load session ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (loadedSession && !state.session) {
      dispatch({ type: 'SESSION_LOADED', session: loadedSession, paths });
    }
  }, [loadedSession]);

  // ── All side effects in one hook ──────────────────────────────────────────
  useSideEffects(state, dispatch, { sessionId, saveState, appendEvent });

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return <Text>Loading session...</Text>;
  if (sessionError)
    return (
      <Text color="red">
        {sessionError}
        {'\nPress q to exit.'}
      </Text>
    );
  if (!state.session) return <Text color="red">Session unavailable.</Text>;

  const { mode, session, selectedId, sidebarScrollOffset, jsonScrollOffset, editor } = state;

  if (mode.type === 'finalized') return <FinalizedScreen result={mode} />;

  const selectedRecord = session.components.find((c) => c.id === selectedId) ?? null;
  const sessionDetail = selectedRecord ? createReviewSessionDetail({ ...session, components: [selectedRecord] }) : null;
  const selectedDetail = sessionDetail?.components[0] ?? null;

  const counts = {
    accepted: session.components.filter((c) => c.status === 'accepted').length,
    rejected: session.components.filter((c) => c.status === 'rejected').length,
    reviewed: session.components.filter((c) => c.status === 'reviewed').length,
    needsReview: session.components.filter((c) => c.status === 'needs-review').length,
  };

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
  const longestName = session.components.reduce((m, c) => Math.max(m, c.name.length), 0);
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
          accepted={counts.accepted}
          rejected={counts.rejected}
          needsReview={counts.needsReview}
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
                editorState={isEditing ? editor : null}
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
          accepted={counts.accepted}
          rejected={counts.rejected}
          reviewed={counts.reviewed}
          needsReview={counts.needsReview}
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
            <Text dimColor>{result.excluded} excluded</Text>
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

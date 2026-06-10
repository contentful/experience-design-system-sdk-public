import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useStdout, useStdin } from 'ink';
import { readFile } from 'node:fs/promises';
import type { PreviewAnnotation, ReviewComponentStatus, ReviewSessionSnapshot } from '../types.js';
import { createReviewSessionDetail } from '../types.js';
import { stripScoringFields } from '../../../types.js';
import { TopBar } from './components/TopBar.js';
import { Sidebar } from './components/Sidebar.js';
import { ComponentDetail } from './components/ComponentDetail.js';
import { StatusBar } from './components/StatusBar.js';
import { HelpOverlay } from './components/HelpOverlay.js';
import { FinalizeDialog } from './components/FinalizeDialog.js';
import { QuitDialog } from './components/QuitDialog.js';
import { PreviewSummaryBar } from './components/PreviewSummaryBar.js';
import { useKeymap } from './hooks/useKeymap.js';
import { useImmediateInput } from './hooks/useImmediateInput.js';
import { useSession } from './hooks/useSession.js';
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
  const { setRawMode } = useStdin();

  // Manage raw mode once at the App level so useImmediateInput doesn't toggle
  // it per-hook — concurrent setRawMode(false) calls during re-renders caused flicker
  useEffect(() => {
    setRawMode(true);
    return () => {
      setRawMode(false);
    };
  }, [setRawMode]);
  const terminalWidth = stdout?.columns ?? 80;

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

  const [session, setSession] = useState<ReviewSessionSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftsByComponentId, setDraftsByComponentId] = useState<Record<string, string>>({});
  const [sidebarFocused, setSidebarFocused] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [sourceVisible, setSourceVisible] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false);
  const [showQuitDialog, setShowQuitDialog] = useState(false);
  const [isSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [finalizedResult, setFinalizedResult] = useState<{
    accepted: number;
    rejected: number;
    excluded: number;
  } | null>(null);
  const [sidebarScrollOffset, setSidebarScrollOffset] = useState(0);
  const [jsonScrollOffset, setJsonScrollOffset] = useState(0);
  // Keeps the visual sort order in sync for use inside keymap handlers (which close over a stale render)
  const sortedIdsRef = useRef<string[]>([]);
  // Source code kept separate from session state so lazy loading never mutates
  // session.components — that would invalidate useMemo(sessionSummary) and flash the sidebar
  const [sourceCodeById, setSourceCodeById] = useState<Record<string, string>>({});
  const [previewAnnotations, setPreviewAnnotations] = useState<Record<string, PreviewAnnotation>>(() => {
    const raw = process.env['EDS_PREVIEW_ANNOTATIONS'];
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, PreviewAnnotation>;
    } catch {
      return {};
    }
  });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewResponse, setPreviewResponse] = useState<ServerPreviewResponse | null>(null);

  const refreshPreview = useCallback(async () => {
    const cmaToken = process.env['EDS_CMA_TOKEN'];
    const spaceId = process.env['EDS_SPACE_ID'];
    const environmentId = process.env['EDS_ENVIRONMENT_ID'];
    const tokensPath = process.env['EDS_TOKENS_PATH'];
    if (!cmaToken || !spaceId || !environmentId) return;

    setPreviewLoading(true);
    try {
      const db = openPipelineDb();
      let components: Array<{ key: string; entry: unknown }> = [];
      try {
        components = loadCDFComponents(db, sessionId);
      } finally {
        db.close();
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

      const annotations: Record<string, PreviewAnnotation> = {};
      for (const item of preview.components.new) {
        const name = ((item as unknown as Record<string, unknown>).name as string) ?? '';
        if (name) annotations[name] = 'new';
      }
      for (const item of preview.components.removed) {
        annotations[item.name] = 'removed';
      }
      for (const item of preview.components.changed) {
        if (item.changeClassification?.classification === 'breaking') {
          annotations[item.current.name] = 'breaking';
        } else {
          annotations[item.current.name] = 'changed';
        }
      }
      setPreviewAnnotations(annotations);
      setPreviewResponse(preview);
      setPreviewError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPreviewError(msg.includes('token') ? 'Preview request failed' : msg);
    } finally {
      setPreviewLoading(false);
    }
  }, [sessionId]);

  const syncSessionToDb = useCallback(
    (currentSession: ReviewSessionSnapshot) => {
      const db = openPipelineDb();
      try {
        db.prepare(`UPDATE raw_components SET status = 'extracted' WHERE session_id = ?`).run(sessionId);
        const acceptedNames = currentSession.components
          .filter((c) => c.status === 'accepted' || c.status === 'reviewed')
          .map((c) => c.name);
        if (acceptedNames.length > 0) {
          db.prepare(
            `UPDATE raw_components SET status = 'generated' WHERE session_id = ? AND name IN (${acceptedNames.map(() => '?').join(',')})`,
          ).run(sessionId, ...acceptedNames);
        }
      } finally {
        db.close();
      }
    },
    [sessionId],
  );

  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedRefreshPreview = useCallback(
    (currentSession: ReviewSessionSnapshot) => {
      if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
      previewDebounceRef.current = setTimeout(() => {
        syncSessionToDb(currentSession);
        void refreshPreview();
      }, 500);
    },
    [syncSessionToDb, refreshPreview],
  );

  useEffect(() => {
    return () => {
      if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    };
  }, []);

  // Sync loaded session into local state; selectedId is set to null here
  // and will be corrected to the first sorted item on first render via the effect below
  useEffect(() => {
    if (loadedSession && !session) {
      setSession(loadedSession);
      setSelectedId(null);
    }
  }, [loadedSession]);

  // Once the sort order is known (after first render), select the first sorted item.
  // Runs only when session transitions from null → loaded.
  const sessionLoaded = session !== null;
  useEffect(() => {
    if (sessionLoaded && selectedId === null && sortedIdsRef.current.length > 0) {
      setSelectedId(sortedIdsRef.current[0]!);
    }
  }, [sessionLoaded]);

  useEffect(() => {
    if (session && !previewResponse) {
      const raw = process.env['EDS_PREVIEW_COUNTS'];
      if (raw) {
        try {
          const counts = JSON.parse(raw) as {
            compNew: number;
            compChanged: number;
            compRemoved: number;
            compUnchanged: number;
            tokNew: number;
            tokChanged: number;
            tokRemoved: number;
            tokUnchanged: number;
          };
          setPreviewResponse({
            components: {
              new: Array(counts.compNew).fill({}),
              changed: Array(counts.compChanged).fill({}),
              removed: Array(counts.compRemoved).fill({}),
              unchanged: Array(counts.compUnchanged).fill({}),
            },
            tokens: {
              new: Array(counts.tokNew).fill({}),
              changed: Array(counts.tokChanged).fill({}),
              removed: Array(counts.tokRemoved).fill({}),
              unchanged: Array(counts.tokUnchanged).fill({}),
            },
          } as unknown as ServerPreviewResponse);
        } catch (err) {
          process.stderr.write(
            `[eds] failed to parse EDS_PREVIEW_COUNTS: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
      }
    }
  }, [session]);

  // Lazy source code loading — writes to sourceCodeById, NOT session.components,
  // so it doesn't invalidate useMemo(sessionSummary) and cause a sidebar flash
  useEffect(() => {
    if (!session || !selectedId) return;
    if (sourceCodeById[selectedId] !== undefined) return; // already loaded
    const selectedComponent = session.components.find((c) => c.id === selectedId);
    if (!selectedComponent) return;

    readFile(selectedComponent.resolvedSourcePath, 'utf8')
      .then((code) => {
        setSourceCodeById((prev) => ({ ...prev, [selectedId]: code }));
      })
      .catch(() => {
        setSourceCodeById((prev) => ({ ...prev, [selectedId]: '' }));
      });
  }, [selectedId]);

  // SIGINT handler
  useEffect(() => {
    const handler = () => {
      if (Object.keys(draftsByComponentId).length > 0) {
        setShowQuitDialog(true);
      } else {
        process.exit(1);
      }
    };
    process.on('SIGINT', handler);
    return () => {
      process.off('SIGINT', handler);
    };
  }, [draftsByComponentId]);

  const updateStatus = async (componentId: string, newStatus: ReviewComponentStatus) => {
    if (!session || !paths) return;
    const updatedSession: ReviewSessionSnapshot = {
      ...session,
      components: session.components.map((c) => (c.id === componentId ? { ...c, status: newStatus } : c)),
    };
    setSession(updatedSession);
    await saveState(updatedSession);
    const component = session.components.find((c) => c.id === componentId);
    await appendEvent({
      type: 'status_changed',
      payload: { componentId, from: component?.status, to: newStatus },
    });
    debouncedRefreshPreview(updatedSession);
  };

  const dialogOpen = showHelp || showFinalizeDialog || showQuitDialog;

  useKeymap(
    {
      sidebarFocused,
      editMode,
      dialogOpen,
      disabled: isSaving,
    },
    {
      onSidebarUp: () => {
        if (!session) return;
        const ids = sortedIdsRef.current;
        const idx = ids.indexOf(selectedId ?? '');
        if (idx > 0) {
          setSelectedId(ids[idx - 1]!);
          setJsonScrollOffset(0);
          setSidebarScrollOffset((prev) => Math.min(prev, idx - 1));
        }
      },
      onSidebarDown: () => {
        if (!session) return;
        const ids = sortedIdsRef.current;
        const idx = ids.indexOf(selectedId ?? '');
        if (idx < ids.length - 1) {
          setSelectedId(ids[idx + 1]!);
          setJsonScrollOffset(0);
          setSidebarScrollOffset((prev) => {
            const newIdx = idx + 1;
            return newIdx >= prev + visibleCount ? newIdx - visibleCount + 1 : prev;
          });
        }
      },
      onSidebarSelect: () => {},
      onAccept: () => {
        if (selectedId) void updateStatus(selectedId, 'accepted');
      },
      onReject: () => {
        if (selectedId) void updateStatus(selectedId, 'rejected');
      },
      onEnterEditMode: () => {
        if (!session || !selectedId) return;
        const component = session.components.find((c) => c.id === selectedId);
        if (!component) return;
        setEditMode(true);
        setDraftsByComponentId((prev) => ({
          ...prev,
          [selectedId]: prev[selectedId] ?? JSON.stringify(stripScoringFields(component.editedProposal), null, 2),
        }));
      },
      onToggleSource: () => {
        if (terminalWidth < 120) {
          setSaveError('Terminal too narrow for source panel (need 120+ cols)');
          setTimeout(() => setSaveError(null), 3000);
          return;
        }
        setSourceVisible((prev) => !prev);
      },
      onScrollUp: () => {
        setJsonScrollOffset((prev) => Math.max(0, prev - 1));
      },
      onScrollDown: () => {
        setJsonScrollOffset((prev) => prev + 1);
      },
      onToggleFocus: () => setSidebarFocused((prev) => !prev),
      onApproveAll: async () => {
        if (!session || !paths) return;
        const updatedComponents = session.components.map((c) =>
          c.status === 'needs-review' ? { ...c, status: 'accepted' as ReviewComponentStatus } : c,
        );
        const affected =
          updatedComponents.filter((c) => c.status === 'accepted').length -
          session.components.filter((c) => c.status === 'accepted').length;
        const updatedSession = { ...session, components: updatedComponents };
        setSession(updatedSession);
        await saveState(updatedSession);
        await appendEvent({ type: 'approve_all', payload: { affected } });
        syncSessionToDb(updatedSession);
        void refreshPreview();
      },
      onFinalize: () => setShowFinalizeDialog(true),
      onQuit: () => {
        if (Object.keys(draftsByComponentId).length > 0) {
          setShowQuitDialog(true);
        } else {
          process.exit(1);
        }
      },
      onToggleHelp: () => setShowHelp((prev) => !prev),
    },
  );

  // Sorted order: flagged+unresolved first, then ascending confidence.
  // Memoised above early returns (React rules of hooks) so the array reference
  // is stable between renders — prevents Sidebar repainting on scroll/select.
  const sessionSummary = useMemo(
    () =>
      (session?.components ?? [])
        .map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          previewAnnotation: previewAnnotations[c.name] as PreviewAnnotation | undefined,
          extractionConfidence: c.originalProposal.extractionConfidence ?? null,
          needsReview: c.originalProposal.needsReview ?? false,
        }))
        .sort((a, b) => {
          const aFlagged = a.needsReview && a.status === 'needs-review' ? 0 : 1;
          const bFlagged = b.needsReview && b.status === 'needs-review' ? 0 : 1;
          if (aFlagged !== bFlagged) return aFlagged - bFlagged;
          // null (unscored) sorts last; lower numeric score sorts first (most concerning)
          const aConf = a.extractionConfidence ?? 6;
          const bConf = b.extractionConfidence ?? 6;
          return aConf - bConf;
        }),
    [session?.components, previewAnnotations],
  );

  // Stable ID order — kept in a ref for use inside keymap handlers
  const sortedIds = useMemo(() => sessionSummary.map((c) => c.id), [sessionSummary]);
  sortedIdsRef.current = sortedIds;

  if (loading) {
    return <Text>Loading session...</Text>;
  }

  if (sessionError) {
    return (
      <Text color="red">
        {sessionError}
        {'\nPress q to exit.'}
      </Text>
    );
  }

  if (!session || !paths) {
    return <Text color="red">Session unavailable.</Text>;
  }

  if (finalizedResult) {
    return <FinalizedScreen result={finalizedResult} />;
  }

  const selectedRecord = session.components.find((c) => c.id === selectedId) ?? null;
  const sessionDetail = selectedRecord ? createReviewSessionDetail({ ...session, components: [selectedRecord] }) : null;
  const selectedDetail = sessionDetail?.components[0] ?? null;

  const acceptedCount = session.components.filter((c) => c.status === 'accepted').length;
  const rejectedCount = session.components.filter((c) => c.status === 'rejected').length;
  const reviewedCount = session.components.filter((c) => c.status === 'reviewed').length;
  const needsReviewCount = session.components.filter((c) => c.status === 'needs-review').length;

  const hints = editMode
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
  // TopBar(1) + statusbar(1) + footer(1) + border padding(2) = ~5 chrome rows
  const CHROME_ROWS = 5;
  const terminalRows = stdout?.rows ?? 24;
  const visibleCount = Math.max(1, terminalRows - CHROME_ROWS);

  const longestName = session.components.reduce((max, c) => Math.max(max, c.name.length), 0);
  // icon + space + name + 2 border chars; min 14, max 22
  const sidebarWidth = collapsed ? 3 : Math.min(Math.max(longestName + 4, 14), 22);

  const handleDraftSave = async () => {
    if (!selectedId || !session || !paths) return;
    const draft = draftsByComponentId[selectedId];
    if (!draft) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = JSON.parse(draft) as Record<string, any>;
      const currentStatus = session.components.find((c) => c.id === selectedId)?.status;
      const newStatus = currentStatus === 'needs-review' ? ('reviewed' as ReviewComponentStatus) : currentStatus!;

      const updatedSession: ReviewSessionSnapshot = {
        ...session,
        components: session.components.map((c) =>
          c.id === selectedId
            ? {
                ...c,
                editedProposal: parsed as typeof c.editedProposal,
                status: newStatus,
              }
            : c,
        ),
      };

      const { [selectedId]: _removed, ...remainingDrafts } = draftsByComponentId;

      setSession(updatedSession);
      setDraftsByComponentId(remainingDrafts);
      setEditMode(false);

      await saveState(updatedSession);
      await appendEvent({
        type: 'draft_saved',
        payload: { componentId: selectedId },
      });

      // Sync all edited proposals to pipeline DB (keep 'generated' for preview)
      const allEdited = updatedSession.components.map((c) => c.editedProposal);
      const syncDb = openPipelineDb();
      try {
        storeRawComponents(syncDb, sessionId, allEdited, {
          status: 'generated',
          preserveCDF: true,
        });
      } finally {
        syncDb.close();
      }
      void refreshPreview();
    } catch {
      // JSON parse error — JsonEditor already shows the error inline
    }
  };

  const handleDraftDiscard = () => {
    if (!selectedId) return;
    const { [selectedId]: _removed, ...remainingDrafts } = draftsByComponentId;
    setDraftsByComponentId(remainingDrafts);
    setEditMode(false);
  };

  const handleFinalize = async () => {
    if (!session || !paths) return;
    try {
      await appendEvent({
        type: 'finalized',
        payload: {
          accepted: acceptedCount,
          rejected: rejectedCount,
          excluded: needsReviewCount,
        },
      });

      // Write all components back to DB, marking accepted as 'generated'
      // so loadCDFComponents (push/preview) only picks up accepted ones,
      // but loadRawComponents (editor re-entry) still finds all of them
      const acceptedNames = new Set(session.components.filter((c) => c.status === 'accepted').map((c) => c.name));
      const db = openPipelineDb();
      try {
        storeRawComponents(
          db,
          sessionId,
          session.components.map((c) => c.editedProposal),
          { status: 'extracted', preserveCDF: true },
        );
        if (acceptedNames.size > 0) {
          db.prepare(
            `UPDATE raw_components SET status = 'generated' WHERE session_id = ? AND name IN (${[...acceptedNames].map(() => '?').join(',')})`,
          ).run(sessionId, ...acceptedNames);
        }
      } finally {
        db.close();
      }

      const output =
        JSON.stringify(
          {
            status: 'finalized',
            sessionDir: paths.sessionDir,
            accepted: acceptedCount,
            rejected: rejectedCount,
            excluded: needsReviewCount,
          },
          null,
          2,
        ) + '\n';
      process.stdout.write(output);
      setFinalizedResult({
        accepted: acceptedCount,
        rejected: rejectedCount,
        excluded: needsReviewCount,
      });
    } catch (err) {
      setSaveError(String(err));
    }
  };

  return (
    <Box flexDirection="column">
      <TopBar subcommand="analyze select" hints={hints} />

      {showHelp && <HelpOverlay mode="review" onClose={() => setShowHelp(false)} />}

      {showFinalizeDialog && (
        <FinalizeDialog
          accepted={acceptedCount}
          rejected={rejectedCount}
          needsReview={needsReviewCount}
          onConfirm={() => {
            void handleFinalize();
          }}
          onCancel={() => setShowFinalizeDialog(false)}
        />
      )}

      {showQuitDialog && (
        <QuitDialog
          hasUnsavedDrafts={Object.keys(draftsByComponentId).length > 0}
          onConfirm={async () => {
            if (paths) {
              await appendEvent({
                type: 'session_quit',
                payload: { reason: 'user_quit' },
              });
            }
            process.exit(1);
          }}
          onCancel={() => setShowQuitDialog(false)}
        />
      )}

      {!showHelp && !showFinalizeDialog && !showQuitDialog && (
        <Box flexGrow={1}>
          <Sidebar
            components={sessionSummary}
            selectedId={selectedId}
            focused={sidebarFocused}
            scrollOffset={sidebarScrollOffset}
            visibleCount={visibleCount}
            onSelect={(id) => {
              setSelectedId(id);
              setJsonScrollOffset(0);
            }}
            onScrollChange={setSidebarScrollOffset}
            collapsed={collapsed}
            width={sidebarWidth}
          />
          <Box flexGrow={1} paddingLeft={1}>
            {selectedDetail ? (
              <ComponentDetail
                component={selectedDetail}
                sourceCode={selectedId ? (sourceCodeById[selectedId] ?? null) : null}
                draftValue={selectedId ? (draftsByComponentId[selectedId] ?? '') : ''}
                editMode={editMode}
                sourceVisible={sourceVisible}
                jsonScrollOffset={jsonScrollOffset}
                sourceScrollX={0}
                sourceScrollY={0}
                terminalWidth={terminalWidth}
                previewAnnotation={selectedRecord ? previewAnnotations[selectedRecord.name] : undefined}
                onDraftChange={(value) => {
                  if (!selectedId) return;
                  setDraftsByComponentId((prev) => ({
                    ...prev,
                    [selectedId!]: value,
                  }));
                }}
                onSaveDraft={() => {
                  void handleDraftSave();
                }}
                onDiscardDraft={handleDraftDiscard}
                onScrollChange={setJsonScrollOffset}
              />
            ) : (
              <Text dimColor>No component selected</Text>
            )}
          </Box>
        </Box>
      )}

      <PreviewSummaryBar preview={previewResponse} loading={previewLoading} />
      {previewError && <Text color="yellow">{'⚠ Preview: ' + previewError}</Text>}
      {saveError && <Text color="red">{'⚠ ' + saveError}</Text>}

      {!dialogOpen && (
        <StatusBar
          accepted={acceptedCount}
          rejected={rejectedCount}
          reviewed={reviewedCount}
          needsReview={needsReviewCount}
          onApproveAll={() => {}}
          onFinalize={() => setShowFinalizeDialog(true)}
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
    if (key.return || _input === 'q' || key.escape) {
      process.exit(0);
    }
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

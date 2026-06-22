import React, { useEffect, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { Sidebar } from '../../../analyze/select/tui/components/Sidebar.js';
import { JsonPanel } from '../../../analyze/select/tui/components/JsonPanel.js';
import { FieldEditor } from '../../../analyze/select/tui/components/FieldEditor.js';
import { StatusBar } from '../../../analyze/select/tui/components/StatusBar.js';
import { FinalizeDialog } from '../../../analyze/select/tui/components/FinalizeDialog.js';
import { QuitDialog } from '../../../analyze/select/tui/components/QuitDialog.js';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';
import { openPipelineDb, loadCDFComponents, storeCDFComponents } from '../../../session/db.js';
import type { ReviewComponentStatus, ReviewComponentSummary } from '../../../analyze/select/types.js';

type CdfReviewEntry = {
  key: string;
  entry: CDFComponentEntry;
  status: ReviewComponentStatus;
};

type GenerateReviewStepProps = {
  extractSessionId: string;
  onFinalize: (accepted: number, rejected: number) => void;
  onQuit: () => void;
};

const VISIBLE_COUNT = 20;
const PANEL_HEIGHT = 22;

export function GenerateReviewStep({
  extractSessionId,
  onFinalize,
  onQuit,
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
      setComponents(cdfComponents.map(({ key, entry }) => ({ key, entry, status: 'needs-review' })));
      setLoading(false);
    }
    load().catch((e: unknown) => {
      setLoadError(String(e));
      setLoading(false);
    });
  }, []);

  const updateStatus = (idx: number, status: ReviewComponentStatus) => {
    setComponents((prev) => prev.map((c, i) => (i === idx ? { ...c, status } : c)));
  };

  const handleFinalizeConfirm = () => {
    const rejected = components.filter((c) => c.status === 'rejected').map((c) => c.key);
    if (rejected.length > 0) {
      const db = openPipelineDb();
      try {
        const stmt = db.prepare(
          `UPDATE raw_components SET status = 'generate-rejected' WHERE session_id = ? AND name = ?`,
        );
        db.exec('BEGIN');
        try {
          for (const name of rejected) {
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
    const accepted = components.filter((c) => c.status !== 'rejected').length;
    onFinalize(accepted, rejected.length);
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
      return;
    }

    if (key.upArrow || input === 'k') {
      const newIdx = Math.max(0, selectedIdx - 1);
      setSelectedIdx(newIdx);
      setJsonScrollOffset(0);
      setDraftValue('');
      setSaveError(null);
      setSidebarScrollOffset((prev) => Math.min(prev, newIdx));
    } else if (key.downArrow || input === 'j') {
      const newIdx = Math.min(components.length - 1, selectedIdx + 1);
      setSelectedIdx(newIdx);
      setJsonScrollOffset(0);
      setDraftValue('');
      setSaveError(null);
      setSidebarScrollOffset((prev) => (newIdx >= prev + VISIBLE_COUNT ? newIdx - VISIBLE_COUNT + 1 : prev));
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

  const sidebarItems: ReviewComponentSummary[] = components.map((c) => ({
    id: c.key,
    name: c.key,
    status: c.status,
    extractionConfidence: null,
    needsReview: false,
    validationErrorCount: 0,
    validationWarningCount: 0,
  }));

  const longestName = components.reduce((m, c) => Math.max(m, c.key.length), 0);
  const sidebarWidth = Math.min(Math.max(longestName + 4, 14), 22);
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
                {showJson ? (
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
                  />
                )}
                {saveError && <Text color="red">{'✗ ' + saveError}</Text>}
                <Text dimColor>
                  {sidebarFocused
                    ? '  [a] accept  [r] reject  [A] accept all  [J] ' +
                      (showJson ? 'hide JSON' : 'show JSON') +
                      '  [F] finalize  [e/Tab] focus panel  [q] quit'
                    : '  [Tab] focus list  ' + (showJson ? '(JSON view)' : '(edit fields)')}
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

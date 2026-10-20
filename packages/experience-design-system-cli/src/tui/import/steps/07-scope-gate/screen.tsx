import React from 'react';
import { Box, Text } from 'ink';
import { StepHeader } from '../../shared/index.js';
import { AddedColumn } from './panels/added-column.js';
import { CyclesPanel } from './panels/cycles-panel.js';
import { RejectPrompt } from './panels/reject-prompt.js';
import { CompactControlBar } from './sidebar/components/CompactControlBar.js';
import { CounterStrip } from './sidebar/components/CounterStrip.js';
import { GotoBanner } from './sidebar/components/GotoBanner.js';
import { GroupedSidebar } from './sidebar/components/GroupedSidebar.js';
import { HelpOverlay, type HelpSection } from './sidebar/components/HelpOverlay.js';
import { SearchMatchSummary } from './sidebar/components/SearchMatchSummary.js';
import { createSidebarViewsHelpSection } from './sidebar/sidebar-help.js';
import { PALETTE } from '@tui/theme.js';
import type { ScopeComponent, ScopeDecisions } from './types.js';
import { useScopeGate } from './use-scope-gate.js';

interface ScopeGateScreenProps {
  components: ScopeComponent[];
  onConfirm: (decisions: ScopeDecisions) => void;
  onQuit: () => void;
}

const HELP_SECTIONS: HelpSection[] = [
  {
    title: 'Navigation',
    entries: [
      { keys: '↑ / ↓', label: 'Move cursor' },
      { keys: 'Tab / Shift-Tab', label: 'Switch column' },
      { keys: 'Enter', label: 'Jump to row in main column' },
    ],
  },
  {
    title: 'Selection',
    entries: [
      { keys: 'a', label: 'Accept' },
      { keys: 'r', label: 'Reject' },
      { keys: 'A', label: 'Toggle all' },
      { keys: 'Y', label: 'Accept non-flagged' },
    ],
  },
  createSidebarViewsHelpSection(false),
  {
    title: 'Panels',
    entries: [
      { keys: 'c', label: 'Cycle list' },
      { keys: 'd', label: 'Show slot dependenciess' },
      { keys: 'x', label: 'Review flags' },
    ],
  },
  { title: 'Search', entries: [{ keys: '/', label: 'Search' }] },
  {
    title: 'General',
    entries: [
      { keys: 'f', label: 'Continue' },
      { keys: 'h', label: 'Close help' },
      { keys: 'q', label: 'Quit' },
    ],
  },
];

// Layout and panels only. State and keys are in use-scope-gate.ts, the decisions in state.ts, the graph in graph/, the
// column sizes in columns.ts and what a key means in keymap.ts.
export function ScopeGateScreen(props: ScopeGateScreenProps): React.ReactElement {
  // Checked here, not in the hook, so an empty list never builds a graph or binds the keys.
  if (props.components.length === 0) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text color={PALETTE.error}>Error: no components found for this session — please re-run analyze extract.</Text>
      </Box>
    );
  }
  return <ScopeGateView {...props} />;
}

function ScopeGateView({ components, onConfirm, onQuit }: ScopeGateScreenProps): React.ReactElement {
  const gate = useScopeGate({ components, onConfirm, onQuit });
  const { search, graph, columnPlan, panelLayout, counters } = gate;

  if (gate.showHelp) {
    return <HelpOverlay sections={HELP_SECTIONS} handleInput={false} onClose={gate.closeHelp} />;
  }

  return (
    <Box flexDirection="column">
      <StepHeader step="scope-gate" />
      <Box flexDirection="column" paddingX={2}>
        <Box flexDirection="row" flexWrap="wrap">
          <CounterStrip counters={counters} totalWidth={gate.totalWidth} />
          {gate.aiExcludedCount > 0 && (
            <Text color={PALETTE.muted}>
              {`${gate.aiExcludedCount} component${gate.aiExcludedCount === 1 ? '' : 's'} flagged by AI`}
              {gate.aiRows.length > 0 && <Text color={PALETTE.accent}>{' — press [x] to see why'}</Text>}
            </Text>
          )}
        </Box>
        {graph.cycles.length > 0 && (
          <Box marginTop={1}>
            <Text color={PALETTE.muted}>
              If you must have components with cycles, select them together into the generate step and then use the
              editor to fix them.
            </Text>
          </Box>
        )}

        <Box flexDirection="row" alignItems="stretch">
          {gate.aiRationalePanelOpen ? (
            <GotoBanner
              title={`Review flags (${gate.aiExcludedCount})`}
              rows={gate.aiRows}
              cursor={gate.aiCursor}
              maxRows={gate.panelMaxRows}
              width={columnPlan.main}
              footerHint="[↑/↓] move · [Enter] jump · [x/Esc] close"
            />
          ) : (
            <GroupedSidebar
              items={gate.groupedItems}
              cycleParticipants={graph.cycleParticipants}
              selectedIdx={gate.visibleRows[gate.safeCursor]?.itemIdx ?? -1}
              selectedRowIdx={gate.safeCursor}
              onSelect={() => {}}
              expandedGroups={gate.expandedGroups}
              onToggleExpanded={gate.toggleExpanded}
              width={columnPlan.main}
              height={panelLayout.height}
              title="All components"
              wrapLabels
              focused={gate.focusedColumn === 'main'}
              scrollOffset={gate.scrollOffset}
              visibleCount={gate.visibleCount}
              showFlatTier={false}
              selectionStateByKey={gate.selectionStateByKey}
              aiFlaggedByKey={gate.aiFlaggedByKey}
              dimPredicate={gate.dimPredicate}
              visibleRows={gate.visibleRows}
              emptyMessage={gate.emptyMessage}
              viewMode={gate.columnOneView}
              graph={graph.nodes}
            />
          )}
          {columnPlan.layout === 'two-column' && (
            <>
              <Box width={2} flexShrink={0} />
              <AddedColumn
                width={columnPlan.added}
                entries={gate.addedComponents}
                cursor={gate.safeAddedComponentsCursor}
                focused={gate.focusedColumn === 'added-components'}
                height={panelLayout.height}
                title={`Accepted Components (${counters.accepted}/${counters.total})`}
                aiFlaggedByKey={gate.aiFlaggedByKey}
                visibleCount={panelLayout.sideVisibleCount}
              />
            </>
          )}
        </Box>

        {gate.cyclesPanelOpen && <CyclesPanel cycles={gate.slotCycles} cursor={gate.cyclesCursor} />}
        {gate.pendingRejectCascade && <RejectPrompt pending={gate.pendingRejectCascade} />}

        <SearchMatchSummary
          open={search.searchOpen}
          query={search.searchQuery}
          matches={search.searchQuery ? gate.searchMatches.length : 0}
          total={components.length}
          autocompleteCandidates={search.autocompleteCandidates}
          marginTop={1}
        />

        <CompactControlBar
          hasGroupRoots={gate.hasGroupRoots}
          searchActive={search.searchOpen || search.searchQuery.length > 0}
        />
      </Box>
    </Box>
  );
}

import React from 'react';
import { Box, Text } from 'ink';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import type { CdfReviewEntry } from '../hooks/useReviewSession.js';
import type { UseReviewEditorResult } from '../hooks/useReviewEditor.js';
import type { UseLivePreviewReturn } from '../useLivePreview.js';
import { getReviewJsonPanelValue } from '../steps/review-json-panel.js';
import { ReviewDetailsEditor, type ReviewDetailsEditorProps } from './ReviewDetailsEditor.js';

type ReviewDetailsEditorConfig = Pick<
  ReviewDetailsEditorProps,
  | 'componentRationale'
  | 'reviewMetadata'
  | 'reviewEditor'
  | 'width'
  | 'height'
  | 'sourceBorderColor'
  | 'jsonValue'
  | 'sidebarFocused'
  | 'fieldEditor'
>;

export type ReviewComponentPanelProps = ReviewDetailsEditorConfig & {
  selectedKey: string;
  selectedEntry: CDFComponentEntry;
  saveError: string | null;
  sidebarFooter: React.ReactNode;
  livePreview: Pick<UseLivePreviewReturn, 'status' | 'disabled'>;
  livePreviewSpinner: string;
};

type ReviewFieldEditor = ReviewDetailsEditorProps['fieldEditor'];

export function buildReviewFieldEditor(
  reviewEditor: UseReviewEditorResult,
  selectedJson: string,
  onExit: () => void,
  overrides: Partial<ReviewFieldEditor> = {},
): ReviewFieldEditor {
  return {
    value: reviewEditor.draftValue || selectedJson,
    showHiddenProps: reviewEditor.showHiddenProps,
    onChange: reviewEditor.setDraftValue,
    onSave: reviewEditor.handleEditSave,
    onDiscard: reviewEditor.handleEditDiscard,
    onExit,
    onTogglePropRationale: () => {
      reviewEditor.setPanelOpen('prop-rationale');
      reviewEditor.setPanelScrollOffset(() => 0);
    },
    onToggleComponentRationale: () => {
      reviewEditor.setPanelOpen('component-rationale');
      reviewEditor.setPanelScrollOffset(() => 0);
    },
    onToggleSourceExternal: () => {
      reviewEditor.setPanelOpen('source');
      reviewEditor.setPanelScrollOffset(() => 0);
    },
    onTextEntryActiveChange: reviewEditor.setTextEntryActive,
    initialFocusTarget: { kind: 'description' },
    ...overrides,
  };
}

export function getReviewSelectionState(
  components: ReadonlyArray<CdfReviewEntry>,
  selectedIdx: number,
  showHiddenProps: boolean,
): {
  selected: CdfReviewEntry | null;
  selectedJson: string;
  visibleJsonPanelValue: string;
} {
  const selected = components[selectedIdx] ?? null;
  const selectedJson = selected ? JSON.stringify({ [selected.key]: selected.entry }, null, 2) : '';
  return {
    selected,
    selectedJson,
    visibleJsonPanelValue: getReviewJsonPanelValue(selected, showHiddenProps),
  };
}

export function ReviewEmptyComponentsWarning({
  count,
  hidden,
}: {
  count: number;
  hidden: boolean;
}): React.ReactElement | null {
  if (hidden || count === 0) return null;
  return (
    <Text color={PALETTE.warning}>
      {`⚠ ${count} component${count === 1 ? '' : 's'} had no classifiable props — review with care`}
    </Text>
  );
}

export function ReviewNoSelection(): React.ReactElement {
  return (
    <Box flexGrow={1} paddingLeft={1} flexDirection="column">
      <Text dimColor>No component selected</Text>
    </Box>
  );
}

export function ReviewFinalizeError({
  message,
  hidden,
}: {
  message: string | null;
  hidden: boolean;
}): React.ReactElement | null {
  if (hidden || !message) return null;
  return <Text color={PALETTE.error}>{`⚠ ${message}`}</Text>;
}

function ReviewPanelFooter({
  reviewEditor,
  sidebarFocused,
  sidebarFooter,
  livePreview,
  livePreviewSpinner,
}: {
  reviewEditor: Pick<UseReviewEditorResult, 'panelOpen' | 'showJson' | 'currentTokenSuggestions'>;
  sidebarFocused: boolean;
  sidebarFooter: React.ReactNode;
  livePreview: Pick<UseLivePreviewReturn, 'status' | 'disabled'>;
  livePreviewSpinner: string;
}): React.ReactElement {
  return (
    <>
      {reviewEditor.panelOpen === 'token-review'
        ? '  [↑/↓] move  [Enter] edit allowed  [Esc] close'
        : sidebarFocused
          ? sidebarFooter
          : reviewEditor.showJson
            ? '  [j/k] scroll  [Ctrl+u/d] half-page  [gg/G] top/bottom  [Tab] focus list'
            : '  [Tab] focus list  (edit fields)' +
              (reviewEditor.currentTokenSuggestions().length > 0 ? '  [t] token review' : '')}
      {livePreview.status === 'running' && <Text>{`  ${livePreviewSpinner} live preview`}</Text>}
      {livePreview.disabled && <Text>{'  · live preview disabled'}</Text>}
    </>
  );
}

export function ReviewComponentPanel({
  selectedKey,
  selectedEntry,
  componentRationale,
  reviewMetadata,
  reviewEditor,
  width,
  height,
  sourceBorderColor,
  jsonValue,
  sidebarFocused,
  fieldEditor,
  saveError,
  sidebarFooter,
  livePreview,
  livePreviewSpinner,
}: ReviewComponentPanelProps): React.ReactElement {
  const propCount = Object.keys(selectedEntry.$properties).length;
  const slotCount = selectedEntry.$slots ? Object.keys(selectedEntry.$slots).length : 0;
  return (
    <Box flexGrow={1} paddingLeft={1} flexDirection="column">
      <Box>
        <Text bold>{selectedKey}</Text>
        <Box flexGrow={1} />
        <Text dimColor>
          {propCount} prop{propCount !== 1 ? 's' : ''}
          {slotCount > 0 ? ` · ${slotCount} slot${slotCount !== 1 ? 's' : ''}` : ''}
          {'  '}
          {sidebarFocused ? '[Tab] focus panel' : '[Tab] focus list'}
        </Text>
      </Box>
      <ReviewDetailsEditor
        selectedKey={selectedKey}
        componentRationale={componentRationale}
        reviewMetadata={reviewMetadata}
        reviewEditor={reviewEditor}
        width={width}
        height={height}
        sourceBorderColor={sourceBorderColor}
        jsonValue={jsonValue}
        sidebarFocused={sidebarFocused}
        fieldEditor={fieldEditor}
      />
      {saveError && <Text color={PALETTE.error}>{'✗ ' + saveError}</Text>}
      <Text dimColor>
        <ReviewPanelFooter
          reviewEditor={reviewEditor}
          sidebarFocused={sidebarFocused}
          sidebarFooter={sidebarFooter}
          livePreview={livePreview}
          livePreviewSpinner={livePreviewSpinner}
        />
      </Text>
    </Box>
  );
}

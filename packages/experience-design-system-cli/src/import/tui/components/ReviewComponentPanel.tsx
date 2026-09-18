import React from 'react';
import { Box, Text } from 'ink';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
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
  footer: React.ReactNode;
};

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
  footer,
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
      <Text dimColor>{footer}</Text>
    </Box>
  );
}

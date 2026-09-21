import React from 'react';
import {
  FieldEditor,
  type FieldEditorMetadata,
  type FieldEditorProps,
} from '../../../analyze/select/tui/components/FieldEditor.js';
import type { ComponentReviewMetadata } from '../../../session/db.js';
import { ReviewDetailsPanel, type ReviewDetailsPanelProps } from '../steps/review-details-panel.js';
import type { UseReviewEditorResult } from '../hooks/useReviewEditor.js';

type ReviewEditorPanelState = Pick<
  UseReviewEditorResult,
  | 'panelOpen'
  | 'panelScrollOffset'
  | 'tokenReviewRow'
  | 'tokenReviewEditing'
  | 'tokenReviewEditCursor'
  | 'tokenReviewEditSelection'
  | 'showJson'
  | 'jsonScrollOffset'
  | 'currentTokenSuggestions'
>;

export type ReviewDetailsEditorProps = Omit<
  ReviewDetailsPanelProps,
  | 'editor'
  | 'panelOpen'
  | 'panelScrollOffset'
  | 'tokenSuggestions'
  | 'tokenReviewRow'
  | 'tokenReviewEditing'
  | 'tokenReviewEditCursor'
  | 'tokenReviewEditSelection'
  | 'showJson'
  | 'jsonScrollOffset'
> & {
  reviewEditor: ReviewEditorPanelState;
  fieldEditor: Omit<FieldEditorProps, 'active' | 'height' | 'metadata' | 'width'> & {
    key?: string;
  };
};

function toFieldEditorMetadata(reviewMetadata: ComponentReviewMetadata | null): FieldEditorMetadata | undefined {
  if (!reviewMetadata) return undefined;
  return {
    sourcePath: reviewMetadata.sourcePath,
    componentSource: reviewMetadata.componentSource,
    props: reviewMetadata.props,
  };
}

export function ReviewDetailsEditor({
  selectedKey,
  componentRationale,
  reviewMetadata,
  width,
  height,
  sourceBorderColor,
  jsonValue,
  sidebarFocused,
  reviewEditor,
  fieldEditor,
}: ReviewDetailsEditorProps): React.ReactElement {
  const {
    panelOpen,
    panelScrollOffset,
    tokenReviewRow,
    tokenReviewEditing,
    tokenReviewEditCursor,
    tokenReviewEditSelection,
    showJson,
    jsonScrollOffset,
    currentTokenSuggestions,
  } = reviewEditor;

  return (
    <ReviewDetailsPanel
      selectedKey={selectedKey}
      panelOpen={panelOpen}
      componentRationale={componentRationale}
      reviewMetadata={reviewMetadata}
      panelScrollOffset={panelScrollOffset}
      width={width}
      height={height}
      sourceBorderColor={sourceBorderColor}
      tokenSuggestions={currentTokenSuggestions()}
      tokenReviewRow={tokenReviewRow}
      tokenReviewEditing={tokenReviewEditing}
      tokenReviewEditCursor={tokenReviewEditCursor}
      tokenReviewEditSelection={tokenReviewEditSelection}
      showJson={showJson}
      jsonValue={jsonValue}
      jsonScrollOffset={jsonScrollOffset}
      sidebarFocused={sidebarFocused}
      editor={
        <FieldEditor
          {...fieldEditor}
          key={fieldEditor.key ?? selectedKey}
          width={width}
          height={height}
          active={!sidebarFocused}
          metadata={toFieldEditorMetadata(reviewMetadata)}
        />
      }
    />
  );
}

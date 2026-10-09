import React from 'react';
import { Text } from 'ink';
import { ComponentRationalePanel } from '../../../analyze/select/tui/components/ComponentRationalePanel.js';
import { JsonPanel } from '../../../analyze/select/tui/components/JsonPanel.js';
import { RationalePanel, type RationaleRow } from '../../../analyze/select/tui/components/RationalePanel.js';
import { TokenReviewPanel, type TokenPropSuggestion } from '../../../analyze/select/tui/components/TokenReviewPanel.js';
import type { ComponentRationale, ComponentReviewMetadata } from '../../../session/db.js';
import { FixedPanel } from '../../../tui/windowed-panel.js';
import { PALETTE } from '../../../analyze/select/tui/theme.js';

type ReviewPanel = 'none' | 'prop-rationale' | 'component-rationale' | 'source' | 'token-review';

export type ReviewDetailsPanelProps = {
  selectedKey: string;
  panelOpen: ReviewPanel;
  componentRationale: ComponentRationale | null;
  reviewMetadata: ComponentReviewMetadata | null;
  panelScrollOffset: number;
  width: number;
  height: number;
  sourceBorderColor?: string;
  tokenSuggestions: TokenPropSuggestion[];
  tokenReviewRow: number;
  tokenReviewEditing: boolean;
  tokenReviewEditCursor: number;
  tokenReviewEditSelection: Set<string>;
  showJson: boolean;
  jsonValue: string;
  jsonScrollOffset: number;
  sidebarFocused: boolean;
  editor: React.ReactNode;
};

export function ReviewDetailsPanel({
  selectedKey,
  panelOpen,
  componentRationale,
  reviewMetadata,
  panelScrollOffset,
  width,
  height,
  sourceBorderColor = 'gray',
  tokenSuggestions,
  tokenReviewRow,
  tokenReviewEditing,
  tokenReviewEditCursor,
  tokenReviewEditSelection,
  showJson,
  jsonValue,
  jsonScrollOffset,
  sidebarFocused,
  editor,
}: ReviewDetailsPanelProps): React.ReactElement {
  // The bordered scrollable panels reserve two rows for their border. Keep
  // every alternate view inside the same outer slot as the field editor.
  const panelContentHeight = Math.max(1, height - 2);

  if (panelOpen === 'prop-rationale') {
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
        componentName={componentRationale?.name ?? selectedKey}
        rows={rows}
        scrollOffset={panelScrollOffset}
        width={width}
        height={panelContentHeight}
        active={true}
      />
    );
  }

  if (panelOpen === 'component-rationale') {
    return (
      <ComponentRationalePanel
        data={
          componentRationale ?? {
            name: selectedKey,
            description: null,
            descriptionRationale: null,
            propsRationale: null,
            slotsRationale: null,
            props: [],
            slots: [],
          }
        }
        scrollOffset={panelScrollOffset}
        width={width}
        height={panelContentHeight}
        active={true}
      />
    );
  }

  if (panelOpen === 'source') {
    const path = reviewMetadata?.sourcePath ?? null;
    const source = reviewMetadata?.componentSource ?? null;
    const headerPath = path ?? '<unknown source path>';
    const sourceLineCount = Math.max(1, height - 4);
    const lines = source ? source.split('\n').slice(panelScrollOffset, panelScrollOffset + sourceLineCount) : [];
    return (
      <FixedPanel width={width} height={height} borderStyle="single" borderColor={sourceBorderColor} paddingLeft={1}>
        <Text color={PALETTE.muted} bold wrap="truncate-end">{`source: ${headerPath}`}</Text>
        {source ? (
          lines.map((line, index) => (
            <Text key={`source-line-${index}`} color={PALETTE.muted} wrap="truncate-end">
              {line}
            </Text>
          ))
        ) : (
          <Text color={PALETTE.muted}>{'(no source captured)'}</Text>
        )}
        <Text color={PALETTE.muted} wrap="truncate-end">
          {'[s/Esc] close'}
        </Text>
      </FixedPanel>
    );
  }

  if (panelOpen === 'token-review') {
    return (
      <TokenReviewPanel
        componentName={selectedKey}
        suggestions={tokenSuggestions}
        selectedRow={tokenReviewRow}
        editing={tokenReviewEditing}
        editCursor={tokenReviewEditCursor}
        editSelection={tokenReviewEditSelection}
        width={width}
        height={panelContentHeight}
        active={true}
      />
    );
  }

  if (showJson) {
    return (
      <JsonPanel
        label="GENERATED DEFINITION (read-only)"
        value={jsonValue}
        scrollOffset={jsonScrollOffset}
        width={width}
        height={panelContentHeight}
        active={!sidebarFocused}
      />
    );
  }

  return <>{editor}</>;
}

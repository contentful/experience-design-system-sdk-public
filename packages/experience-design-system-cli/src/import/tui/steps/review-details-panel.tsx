import React from 'react';
import { Box, Text } from 'ink';
import { ComponentRationalePanel } from '../../../analyze/select/tui/components/ComponentRationalePanel.js';
import { JsonPanel } from '../../../analyze/select/tui/components/JsonPanel.js';
import { RationalePanel, type RationaleRow } from '../../../analyze/select/tui/components/RationalePanel.js';
import { TokenReviewPanel, type TokenPropSuggestion } from '../../../analyze/select/tui/components/TokenReviewPanel.js';
import type { ComponentRationale, ComponentReviewMetadata } from '../../../session/db.js';

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
        height={height}
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
        height={height}
        active={true}
      />
    );
  }

  if (panelOpen === 'source') {
    const path = reviewMetadata?.sourcePath ?? null;
    const source = reviewMetadata?.componentSource ?? null;
    const headerPath = path ?? '<unknown source path>';
    const lines = source ? source.split('\n').slice(panelScrollOffset, panelScrollOffset + height) : [];
    return (
      <Box flexDirection="column" width={width} borderStyle="single" borderColor={sourceBorderColor} paddingX={1}>
        <Text dimColor bold>{`source: ${headerPath}`}</Text>
        {source ? (
          lines.map((line, index) => (
            <Text key={`source-line-${index}`} dimColor>
              {line}
            </Text>
          ))
        ) : (
          <Text dimColor>{'(no source captured)'}</Text>
        )}
        <Text dimColor>{'[s/Esc] close'}</Text>
      </Box>
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
        height={height}
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
        height={height}
        active={!sidebarFocused}
      />
    );
  }

  return <>{editor}</>;
}

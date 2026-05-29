import React from 'react';
import { Box, Text } from 'ink';
import type { PreviewAnnotation, ReviewComponentDetail } from '../../types.js';
import { JsonPanel } from './JsonPanel.js';
import { FieldEditor } from './FieldEditor.js';
import { SourcePanel } from './SourcePanel.js';

type ComponentDetailProps = {
  component: ReviewComponentDetail;
  sourceCode: string | null;
  draftValue: string;
  editMode: boolean;
  sourceVisible: boolean;
  jsonScrollOffset: number;
  sourceScrollX: number;
  sourceScrollY: number;
  terminalWidth: number;
  previewAnnotation?: PreviewAnnotation;
  onDraftChange: (value: string) => void;
  onSaveDraft: () => void;
  onDiscardDraft: () => void;
  onScrollChange: (offset: number) => void;
};

function annotationLabel(annotation: PreviewAnnotation | undefined): { text: string; color: string } | null {
  switch (annotation) {
    case 'breaking':
      return { text: ' ⚠ breaking', color: 'red' };
    case 'changed':
      return { text: ' ~ changed', color: 'yellow' };
    case 'new':
      return { text: ' + new', color: 'green' };
    case 'removed':
      return { text: ' ✗ removed', color: 'red' };
    default:
      return null;
  }
}

export function ComponentDetail({
  component,
  sourceCode,
  draftValue,
  editMode,
  sourceVisible,
  jsonScrollOffset,
  sourceScrollX,
  sourceScrollY,
  terminalWidth,
  previewAnnotation,
  onDraftChange,
  onSaveDraft,
  onDiscardDraft,
}: ComponentDetailProps): React.ReactElement {
  const sidebarWidth = terminalWidth < 80 ? 5 : 20;
  const availableWidth = terminalWidth - sidebarWidth - 2;
  const panelHeight = 20;

  let originalWidth: number;
  let editWidth: number;
  let sourceWidth: number;

  if (sourceVisible && terminalWidth >= 120) {
    originalWidth = Math.floor((availableWidth - 4) / 3);
    editWidth = originalWidth;
    sourceWidth = availableWidth - originalWidth * 2 - 4;
  } else {
    originalWidth = Math.floor((availableWidth - 3) / 2);
    editWidth = availableWidth - originalWidth - 3;
    sourceWidth = 0;
  }

  const originalJson = JSON.stringify(component.originalProposal, null, 2);
  const editedJson = JSON.stringify(component.editedProposal, null, 2);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box>
        <Text bold>{component.name}</Text>
        {(() => {
          const ann = annotationLabel(previewAnnotation);
          return ann ? <Text color={ann.color}>{ann.text}</Text> : null;
        })()}
        <Box flexGrow={1} />
        <Text dimColor>
          {sourceVisible ? '[s] hide src' : '[s] src'}
          {editMode ? '' : '  [e] edit'}
        </Text>
      </Box>
      <Box>
        <JsonPanel
          label="ORIGINAL (read-only)"
          value={originalJson}
          scrollOffset={jsonScrollOffset}
          width={originalWidth}
          height={panelHeight}
          active={false}
        />
        <Text> </Text>
        {editMode ? (
          <FieldEditor
            value={draftValue || editedJson}
            width={editWidth}
            height={panelHeight}
            onChange={onDraftChange}
            onSave={onSaveDraft}
            onDiscard={onDiscardDraft}
          />
        ) : (
          <JsonPanel
            label="EDIT (draft)"
            value={draftValue || editedJson}
            scrollOffset={jsonScrollOffset}
            width={editWidth}
            height={panelHeight}
            active={true}
          />
        )}
        {sourceVisible && sourceWidth > 0 && (
          <>
            <Text> </Text>
            <SourcePanel
              sourceCode={sourceCode}
              filePath={component.originalProposal.source}
              width={sourceWidth}
              height={panelHeight}
              scrollX={sourceScrollX}
              scrollY={sourceScrollY}
            />
          </>
        )}
      </Box>
      {!editMode && <Text dimColor>{'  [a] accept  [r] reject  [e] edit  [A] accept all  [↑↓] scroll'}</Text>}
    </Box>
  );
}

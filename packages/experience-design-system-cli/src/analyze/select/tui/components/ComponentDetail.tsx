import React from 'react';
import { Box, Text } from 'ink';
import type { PreviewAnnotation, ReviewComponentDetail } from '../../types.js';
import type { EditorState } from '../state.js';
import { stripScoringFields } from '../../../../types.js';
import { JsonPanel } from './JsonPanel.js';
import { JsonEditor } from './JsonEditor.js';
import { SourcePanel } from './SourcePanel.js';

type ComponentDetailProps = {
  component: ReviewComponentDetail;
  sourceCode: string | null;
  draftValue: string; // shown in read-only panel when not editing
  editMode: boolean;
  editorState: EditorState | null; // non-null when editMode=true
  sourceVisible: boolean;
  jsonScrollOffset: number;
  sourceScrollX: number;
  sourceScrollY: number;
  terminalWidth: number;
  previewAnnotation?: PreviewAnnotation;
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
  editorState,
  sourceVisible,
  jsonScrollOffset,
  sourceScrollX,
  sourceScrollY,
  terminalWidth,
  previewAnnotation,
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

  const originalJson = JSON.stringify(stripScoringFields(component.originalProposal), null, 2);
  const editedJson = JSON.stringify(stripScoringFields(component.editedProposal), null, 2);

  const conf = component.originalProposal.extractionConfidence ?? null;
  const nr = component.originalProposal.needsReview ?? false;
  const confColor = conf === null ? 'gray' : nr ? 'red' : conf >= 4 ? 'white' : conf >= 3 ? 'yellow' : 'red';
  const confLabel = conf === null ? 'confidence: —' : (nr ? '⚑ ' : '') + 'confidence: ' + String(conf) + '/5';

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box>
        <Text bold>{component.name}</Text>
        {(() => {
          const ann = annotationLabel(previewAnnotation);
          return ann ? <Text color={ann.color}>{ann.text}</Text> : null;
        })()}
        <Text color={confColor}>{' — ' + confLabel}</Text>
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
        {editMode && editorState ? (
          <JsonEditor editorState={editorState} width={editWidth} height={panelHeight} />
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

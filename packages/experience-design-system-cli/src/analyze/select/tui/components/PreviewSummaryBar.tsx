import React from 'react';
import { Box, Text } from 'ink';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';

type PreviewSummaryBarProps = {
  preview: ServerPreviewResponse | null;
  loading: boolean;
};

export function PreviewSummaryBar({ preview, loading }: PreviewSummaryBarProps): React.ReactElement {
  if (!preview && !loading) {
    return <Box />;
  }

  if (loading && !preview) {
    return (
      <Box gap={1}>
        <Text dimColor>↻ Loading preview...</Text>
      </Box>
    );
  }

  const comp = preview!.components;
  const tok = preview!.tokens;

  const parts: Array<{ label: string; color: string }> = [];

  const newCount = comp.new.length + tok.new.length;
  const changedCount = comp.changed.length + tok.changed.length;
  const removedCount = comp.removed.length + tok.removed.length;
  const unchangedCount = comp.unchanged.length + tok.unchanged.length;

  if (newCount > 0) parts.push({ label: `${newCount} new`, color: 'green' });
  if (changedCount > 0) parts.push({ label: `${changedCount} changed`, color: 'yellow' });
  if (removedCount > 0) parts.push({ label: `${removedCount} removed`, color: 'red' });
  if (unchangedCount > 0) parts.push({ label: `${unchangedCount} unchanged`, color: 'gray' });

  if (parts.length === 0 && !loading) {
    return (
      <Box gap={1}>
        <Text dimColor>Preview: no changes detected</Text>
      </Box>
    );
  }

  return (
    <Box gap={1}>
      <Text dimColor>Preview:</Text>
      {parts.map((part, i) => (
        <Text key={i} color={part.color}>
          {part.label}
        </Text>
      ))}
      {loading && <Text dimColor>↻</Text>}
    </Box>
  );
}

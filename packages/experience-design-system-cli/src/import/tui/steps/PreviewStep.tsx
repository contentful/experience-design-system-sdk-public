import React from 'react';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';

type EntitySummary = {
  created: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  failed: number;
};

type PreviewStepProps = {
  componentTypes: EntitySummary;
  designTokens: EntitySummary;
  spaceId: string;
  environmentId: string;
  stepNumber: number;
  totalSteps: number;
  onConfirm: () => void;
  onSaveFiles?: () => void;
  onQuit: () => void;
};

export function PreviewStep({
  componentTypes,
  designTokens,
  spaceId,
  environmentId,
  stepNumber,
  totalSteps,
  onConfirm,
  onSaveFiles,
  onQuit,
}: PreviewStepProps): React.ReactElement {
  useImmediateInput((input, key) => {
    if (key.return) {
      onConfirm();
      return;
    }
    if (input === 's' && onSaveFiles) {
      onSaveFiles();
      return;
    }
    if (input === 'q' || key.escape) {
      onQuit();
      return;
    }
  });

  const hasComponents =
    componentTypes.created > 0 ||
    componentTypes.updated > 0 ||
    componentTypes.unchanged > 0 ||
    componentTypes.conflicts > 0 ||
    componentTypes.failed > 0;
  const hasTokens =
    designTokens.created > 0 ||
    designTokens.updated > 0 ||
    designTokens.unchanged > 0 ||
    designTokens.conflicts > 0 ||
    designTokens.failed > 0;
  const hasAnything = hasComponents || hasTokens;

  function EntityRows({ label, summary }: { label: string; summary: EntitySummary }) {
    if (!summary.created && !summary.updated && !summary.unchanged && !summary.conflicts && !summary.failed)
      return null;
    return (
      <>
        <Box gap={1} marginTop={1}>
          <Text bold dimColor>
            {label}
          </Text>
        </Box>
        {summary.created > 0 && (
          <Box gap={1}>
            <Text color="green"> ＋</Text>
            <Text>{summary.created} will be created</Text>
          </Box>
        )}
        {summary.updated > 0 && (
          <Box gap={1}>
            <Text color="yellow"> ～</Text>
            <Text>{summary.updated} will be updated</Text>
          </Box>
        )}
        {summary.unchanged > 0 && (
          <Box gap={1}>
            <Text dimColor> ·</Text>
            <Text dimColor>{summary.unchanged} unchanged</Text>
          </Box>
        )}
        {summary.conflicts > 0 && (
          <Box gap={1}>
            <Text color="red"> ✗</Text>
            <Text color="red">
              {summary.conflicts} conflict{summary.conflicts !== 1 ? 's' : ''} — resolve before pushing
            </Text>
          </Box>
        )}
        {summary.failed > 0 && (
          <Box gap={1}>
            <Text color="red"> ✗</Text>
            <Text color="red">{summary.failed} failed — check logs</Text>
          </Box>
        )}
      </>
    );
  }

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Box flexDirection="column" gap={0}>
        <Text dimColor>{'─'.repeat(40)}</Text>
        <Box gap={1}>
          <Text bold>
            Step {stepNumber} of {totalSteps}
          </Text>
          <Text bold>—</Text>
          <Text bold>Push to Contentful</Text>
        </Box>
        <Text dimColor>{'─'.repeat(40)}</Text>
      </Box>

      {hasAnything ? (
        <>
          <Text>Here&apos;s what will happen in your space:</Text>
          <Box flexDirection="column" gap={0}>
            {hasComponents && <EntityRows label="ComponentTypes" summary={componentTypes} />}
            {hasTokens && <EntityRows label="Design Tokens" summary={designTokens} />}
          </Box>
        </>
      ) : (
        <Text dimColor>Nothing to push — everything is already up to date.</Text>
      )}

      <Box gap={1} marginTop={1}>
        <Text dimColor>Space:</Text>
        <Text>{spaceId}</Text>
        <Text dimColor>/</Text>
        <Text dimColor>Environment:</Text>
        <Text>{environmentId}</Text>
      </Box>

      <Box gap={3} marginTop={1}>
        <Text dimColor>[Enter] Push to Contentful</Text>
        {onSaveFiles && <Text dimColor>[s] Save files instead</Text>}
        <Text dimColor>[q] Cancel</Text>
      </Box>
    </Box>
  );
}

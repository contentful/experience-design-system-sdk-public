import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../../theme.js';

export const IMPORT_STEPS = [
  { id: 'extraction', title: 'Extracting design system' },
  { id: 'scope-gate', title: 'Review extracted components' },
  { id: 'generation', title: 'Generating definitions' },
  { id: 'review', title: 'Review generated definitions' },
  { id: 'push', title: 'Push to Contentful' },
] as const;

export type ImportStepId = (typeof IMPORT_STEPS)[number]['id'];

export function stepLabel(step: ImportStepId, title?: string): string {
  const index = IMPORT_STEPS.findIndex((candidate) => candidate.id === step);
  return `Step ${index + 1} of ${IMPORT_STEPS.length} — ${title ?? IMPORT_STEPS[index]!.title}`;
}

interface StepHeaderProps {
  step: ImportStepId;
  title?: string;
}

const RULE = '─'.repeat(40);

export function StepHeader({ step, title }: StepHeaderProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text color={PALETTE.muted}>{RULE}</Text>
      <Text bold>{stepLabel(step, title)}</Text>
      <Text color={PALETTE.muted}>{RULE}</Text>
    </Box>
  );
}

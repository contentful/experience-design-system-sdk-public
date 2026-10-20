import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { readPackageVersion } from '@tui/home/version.js';

export const IMPORT_STEPS = [
  { id: 'extraction', label: 'Extract' },
  { id: 'scope-gate', label: 'Select' },
  { id: 'generation', label: 'Generate' },
  { id: 'review', label: 'Review' },
  { id: 'push', label: 'Push' },
] as const;

export type ImportStepId = (typeof IMPORT_STEPS)[number]['id'];

interface StepHeaderProps {
  step: ImportStepId;
}

const version = readPackageVersion();

export function StepHeader({ step }: StepHeaderProps): React.ReactElement {
  const current = IMPORT_STEPS.findIndex((candidate) => candidate.id === step);

  return (
    <Box
      justifyContent="space-between"
      paddingX={2}
      marginBottom={1}
      borderStyle="single"
      borderColor={PALETTE.border}
      borderTop={false}
      borderLeft={false}
      borderRight={false}
    >
      <Box columnGap={3}>
        {IMPORT_STEPS.map((candidate, index) => {
          if (index < current) {
            return (
              <Text key={candidate.id} color={PALETTE.success}>
                ✓ {candidate.label}
              </Text>
            );
          }
          if (index === current) {
            return (
              <Text key={candidate.id} bold color={PALETTE.accent}>
                ● {candidate.label}
              </Text>
            );
          }
          return (
            <Text key={candidate.id} color={PALETTE.muted}>
              ○ {candidate.label}
            </Text>
          );
        })}
      </Box>
      <Text color={PALETTE.muted}>v{version}</Text>
    </Box>
  );
}

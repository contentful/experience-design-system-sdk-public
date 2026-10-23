import React, { createContext, useContext } from 'react';
import { Box, Text } from 'ink';
import figures from 'figures';
import { PALETTE } from '@tui/theme.js';
import { useTerminalWidth } from '@tui/use-terminal-width.js';
import { readPackageVersion } from '@tui/home/version.js';

const IMPORT_STEPS = [
  { id: 'setup', label: 'Setup' },
  { id: 'extraction', label: 'Extract' },
  { id: 'scope-gate', label: 'Select' },
  { id: 'generation', label: 'Generate' },
  { id: 'review', label: 'Review' },
  { id: 'push', label: 'Push' },
] as const;

export type ImportStepId = (typeof IMPORT_STEPS)[number]['id'];

/** Steps the current import never goes through, left out of the header. A tokens-only import has no extract, select or generate. */
export const HiddenStepsContext = createContext<readonly ImportStepId[]>([]);

export interface StepHeaderProps {
  step: ImportStepId | 'done';
}

const version = readPackageVersion();

const VERSION_MIN_COLUMNS = 90;

const WIDE_SPACING_MIN_COLUMNS = 100;

export function StepHeader({ step }: StepHeaderProps): React.ReactElement {
  const columns = useTerminalWidth();
  const padding = columns >= WIDE_SPACING_MIN_COLUMNS ? '  ' : ' ';
  const hidden = useContext(HiddenStepsContext);
  const steps = IMPORT_STEPS.filter((candidate) => !hidden.includes(candidate.id));
  const current = step === 'done' ? steps.length : steps.findIndex((candidate) => candidate.id === step);

  return (
    <Box
      justifyContent="space-between"
      paddingX={2}
      paddingTop={1}
      marginBottom={1}
      borderStyle="single"
      borderColor={PALETTE.border}
      borderTop={false}
      borderLeft={false}
      borderRight={false}
    >
      <Box>
        {steps.map((candidate, index) => (
          <React.Fragment key={candidate.id}>
            {index > 0 && <Text color={PALETTE.muted}>{`${padding}${figures.arrowRight}${padding}`}</Text>}
            {index < current ? (
              <Text color={PALETTE.success}>
                {figures.tick} {candidate.label}
              </Text>
            ) : index === current ? (
              <Text bold color={PALETTE.accent}>
                {figures.bullet} {candidate.label}
              </Text>
            ) : (
              <Text color={PALETTE.muted}>
                {figures.circle} {candidate.label}
              </Text>
            )}
          </React.Fragment>
        ))}
      </Box>
      {columns >= VERSION_MIN_COLUMNS && (
        <Box marginLeft={2}>
          <Text color={PALETTE.muted}>v{version}</Text>
        </Box>
      )}
    </Box>
  );
}

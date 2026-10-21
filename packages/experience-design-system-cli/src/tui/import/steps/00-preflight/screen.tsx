import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { PREFLIGHT_CONTROLS, usePreflightControls } from './controls.js';
import { IMPORT_TARGET_OPTIONS, type ImportTarget } from './logic.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';
import { StepHeader } from '@tui/shared/components/StepHeader.js';

interface PreflightScreenProps {
  onChoose: (target: ImportTarget) => void;
  onQuit: () => void;
}

export function PreflightScreen({ onChoose, onQuit }: PreflightScreenProps): React.ReactElement {
  const [focus, setFocus] = useState(0);

  usePreflightControls({ focus, onFocus: setFocus, onChoose, onQuit });

  return (
    <Box flexDirection="column">
      <StepHeader step="setup" />
      <Box flexDirection="column" gap={1} paddingX={2} paddingBottom={1}>
        <Text bold color={PALETTE.accent}>
          What do you want to generate?
        </Text>
        <Box flexDirection="column">
          {IMPORT_TARGET_OPTIONS.map((option, index) => {
            const focused = index === focus;
            return (
              <Box key={option.target} gap={1}>
                <Text color={PALETTE.accent}>{focused ? '❯' : ' '}</Text>
                <Text bold={focused} color={focused ? PALETTE.accent : undefined}>
                  {option.label}
                </Text>
              </Box>
            );
          })}
        </Box>
        <ControlHints hints={PREFLIGHT_CONTROLS} />
      </Box>
    </Box>
  );
}

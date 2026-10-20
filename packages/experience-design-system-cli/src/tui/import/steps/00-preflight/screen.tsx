import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../../../theme.js';
import { PREFLIGHT_CONTROLS, usePreflightControls } from './controls.js';
import { IMPORT_TARGET_OPTIONS, type ImportTarget } from './logic.js';

interface PreflightScreenProps {
  onChoose: (target: ImportTarget) => void;
  onQuit: () => void;
}

export function PreflightScreen({ onChoose, onQuit }: PreflightScreenProps): React.ReactElement {
  const [focus, setFocus] = useState(0);

  usePreflightControls({ focus, onFocus: setFocus, onChoose, onQuit });

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text bold color={PALETTE.accent}>
        What do you want to generate?
      </Text>
      <Box flexDirection="column">
        {IMPORT_TARGET_OPTIONS.map((option, index) => (
          <Box key={option.target} gap={1}>
            <Text color={PALETTE.accent}>{index === focus ? '❯' : ' '}</Text>
            <Text bold={index === focus}>{option.label}</Text>
            <Text color={PALETTE.muted}>{option.description}</Text>
          </Box>
        ))}
      </Box>
      <Box gap={3}>
        {PREFLIGHT_CONTROLS.map((control) => (
          <Text key={control.keys} color={PALETTE.muted}>
            [{control.keys}] {control.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

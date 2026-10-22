import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { ClearableTextInput } from '../../../shared/components/ClearableTextInput.js';
import { WELCOME_CONTROLS, useWelcomeControls } from './controls.js';
import { toProjectPath } from './logic.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';
import { StepHeader } from '@tui/shared/components/StepHeader.js';

interface WelcomeScreenProps {
  onContinue: (projectPath: string) => void;
  onQuit: () => void;
  initialPath?: string;
}

export function WelcomeScreen({ onContinue, onQuit, initialPath = '' }: WelcomeScreenProps): React.ReactElement {
  const [projectPath, setProjectPath] = useState(initialPath);

  useWelcomeControls(onQuit);

  const submit = (value: string) => {
    const path = toProjectPath(value);
    if (path) onContinue(path);
  };

  return (
    <Box flexDirection="column">
      <StepHeader step="setup" />
      <Box flexDirection="column" gap={1} paddingX={2} paddingBottom={1}>
        <Box flexDirection="column" gap={1}>
          <Text color={PALETTE.text}>Which source folder would you like to import?</Text>
          <Text dimColor>
            Choose an application root, a folder of components, or a folder containing a single component.
          </Text>
          <Box>
            <Text color={PALETTE.accent}>? </Text>
            <Text>Project path: </Text>
            <ClearableTextInput value={projectPath} onChange={setProjectPath} onSubmit={submit} />
          </Box>
        </Box>

        <Box>
          <ControlHints hints={WELCOME_CONTROLS} />
        </Box>
      </Box>
    </Box>
  );
}

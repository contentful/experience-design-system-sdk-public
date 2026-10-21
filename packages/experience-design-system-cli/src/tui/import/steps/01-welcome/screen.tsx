import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { ClearableTextInput } from '../../../shared/components/ClearableTextInput.js';
import { WELCOME_CONTROLS, useWelcomeControls } from './controls.js';
import { toProjectPath } from './logic.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';

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
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text bold color={PALETTE.accent}>
        Let&apos;s import your design system into Contentful.
      </Text>

      <Box flexDirection="column" gap={1}>
        <Text>Where is your component library?</Text>
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
  );
}

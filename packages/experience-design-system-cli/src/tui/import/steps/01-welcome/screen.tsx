import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { ClearableTextInput } from '../../../shared/components/ClearableTextInput.js';
import { OverviewBox, type OverviewStep } from '../../shared/index.js';
import { WELCOME_CONTROLS, useWelcomeControls } from './controls.js';
import { toProjectPath } from './logic.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';

interface WelcomeScreenProps {
  onContinue: (projectPath: string) => void;
  onQuit: () => void;
  initialPath?: string;
}

const OVERVIEW: readonly OverviewStep[] = [
  { description: 'Extract components from your codebase', ai: true },
  { description: 'Review what was extracted', ai: false },
  { description: 'Generate component definitions', ai: true },
  { description: 'Review generated definitions', ai: false },
  { description: 'Push to Contentful', ai: false },
];

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
      <OverviewBox steps={OVERVIEW} />

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

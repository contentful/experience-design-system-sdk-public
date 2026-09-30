import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../../../home/home.theme.js';
import { useBlinkingCursor } from '../../../use-blinking-cursor.js';
import { withCursor } from '../../input/line-editing.js';
import { WELCOME_CONTROLS, useWelcomeControls } from './controls.js';
import { WELCOME_OVERVIEW } from './overview.js';
import type { WelcomeScreenProps } from './types.js';

const RULE = '────────────────────────────────────────';

/**
 * First page of the import flow. Render only: keyboard handling lives in `./controls.ts` and every decision in
 * `./logic.ts`. Reports the outcome through `onContinue` / `onQuit`; never exits the process itself.
 */
export function WelcomeScreen({ onContinue, onQuit }: WelcomeScreenProps): React.ReactElement {
  const [projectPath, setProjectPath] = useState('');
  const cursorVisible = useBlinkingCursor();

  useWelcomeControls({ projectPath, setProjectPath, onContinue, onQuit });

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text bold color={PALETTE.success}>
        👋 Hey! Let&apos;s import your design system into Contentful.
      </Text>
      <Text dimColor>I&apos;ll walk you through 5 steps to get your components into Contentful ExO.</Text>

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{RULE}</Text>
        {WELCOME_OVERVIEW.map((item) => (
          <Box key={item.label} gap={1}>
            <Text bold>{item.label}</Text>
            <Text dimColor>{item.description}</Text>
          </Box>
        ))}
        <Text dimColor>{RULE}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text>Where is your component library?</Text>
        <Box gap={1}>
          <Text color={PALETTE.accent}>?</Text>
          <Text>Project path:</Text>
          <Text>{withCursor(projectPath, cursorVisible)}</Text>
        </Box>
      </Box>

      <Box marginTop={1} gap={3}>
        {WELCOME_CONTROLS.map((control) => (
          <Text key={control.keys} dimColor>
            [{control.keys}] {control.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

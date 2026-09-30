import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '../../../home/home.theme.js';
import { useBlinkingCursor } from '../../../use-blinking-cursor.js';
import { withCursor } from '../../input/line-editing.js';
import { WELCOME_STEPS, reducePathInput } from './logic.js';
import type { WelcomeScreenProps } from './types.js';

const RULE = '────────────────────────────────────────';

/**
 * First page of the import flow. UI only: owns the typed text and cursor blink, and delegates every
 * decision to `./logic.ts`. Reports the outcome through `onContinue` / `onQuit`; never exits the process itself.
 */
export function WelcomeScreen({ onContinue, onQuit }: WelcomeScreenProps): React.ReactElement {
  const [projectPath, setProjectPath] = useState('');
  const cursorVisible = useBlinkingCursor();

  useInput((input, key) => {
    const event = reducePathInput(projectPath, input, key);
    if (event.type === 'edit') setProjectPath(event.value);
    else if (event.type === 'submit') onContinue(event.projectPath);
    else if (event.type === 'quit') onQuit();
  });

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text bold color={PALETTE.success}>
        👋 Hey! Let&apos;s import your design system into Contentful.
      </Text>
      <Text dimColor>I&apos;ll walk you through 5 steps to get your components into Contentful ExO.</Text>

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{RULE}</Text>
        {WELCOME_STEPS.map((step) => (
          <Box key={step.label} gap={1}>
            <Text bold>{step.label}</Text>
            <Text dimColor>{step.description}</Text>
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
        <Text dimColor>[Enter] Continue</Text>
        <Text dimColor>[Esc/q] Back to menu</Text>
      </Box>
    </Box>
  );
}

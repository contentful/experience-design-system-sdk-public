import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { PALETTE } from '../../../home/home.theme.js';
import { WELCOME_CONTROLS, useWelcomeControls } from './controls.js';
import { toProjectPath } from './logic.js';
import type { WelcomeScreenProps } from './types.js';

const RULE = '────────────────────────────────────────';

const OVERVIEW = [
  { label: 'Step 1', description: 'Extract components from your codebase' },
  { label: 'Step 2', description: 'Review what was extracted' },
  { label: 'Step 3', description: 'Generate CDF definitions with Claude' },
  { label: 'Step 4', description: 'Review generated definitions' },
  { label: 'Step 5', description: 'Push to Contentful' },
] as const;

export function WelcomeScreen({ onContinue, onQuit }: WelcomeScreenProps): React.ReactElement {
  const [projectPath, setProjectPath] = useState('');

  useWelcomeControls(projectPath, onQuit);

  const submit = (value: string) => {
    const path = toProjectPath(value);
    if (path) onContinue(path);
  };

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text bold color={PALETTE.success}>
        👋 Hey! Let&apos;s import your design system into Contentful.
      </Text>
      <Text dimColor>I&apos;ll walk you through 5 steps to get your components into Contentful ExO.</Text>

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{RULE}</Text>
        {OVERVIEW.map((item) => (
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
          <TextInput value={projectPath} onChange={setProjectPath} onSubmit={submit} />
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

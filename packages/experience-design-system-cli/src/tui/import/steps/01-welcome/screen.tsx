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

const OVERVIEW_BOX_MAX_WIDTH = 90;

const AI_MARKER = '✻';

const OVERVIEW = [
  {
    label: 'Step 1',
    description: 'Extract components from your codebase',
    ai: true,
  },
  { label: 'Step 2', description: 'Review what was extracted', ai: false },
  {
    label: 'Step 3',
    description: 'Generate component definitions',
    ai: true,
  },
  { label: 'Step 4', description: 'Review generated definitions', ai: false },
  { label: 'Step 5', description: 'Push to Contentful', ai: false },
] as const;

const AI_DISCLOSURE = [
  'Steps marked ✻ use your local AI agent, which may send relevant code to your AI provider under your agreement with them. Contentful does not receive that code, or the prompts and responses. AI suggestions can be wrong or incomplete, so review and edit them before importing.',
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
      <Box flexDirection="row">
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={PALETTE.border}
          paddingX={2}
          paddingY={1}
          width={OVERVIEW_BOX_MAX_WIDTH}
          flexShrink={1}
        >
          {OVERVIEW.map((item) => (
            <Box key={item.label} gap={1}>
              <Box flexShrink={0}>
                <Text bold>{item.label}</Text>
              </Box>
              <Text color={PALETTE.muted} wrap="truncate-end">
                {item.description}
              </Text>
              {item.ai && (
                <Text bold color={PALETTE.accent}>
                  {AI_MARKER}
                </Text>
              )}
            </Box>
          ))}

          <Box flexDirection="column" marginTop={1}>
            <Text bold>
              <Text color={PALETTE.accent}>{AI_MARKER}</Text> AI disclosure
            </Text>
            {AI_DISCLOSURE.map((paragraph) => (
              <Text key={paragraph} color={PALETTE.muted}>
                {paragraph}
              </Text>
            ))}
          </Box>
        </Box>
      </Box>

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

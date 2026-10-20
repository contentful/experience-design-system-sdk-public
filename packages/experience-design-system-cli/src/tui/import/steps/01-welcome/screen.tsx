import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../../../theme.js';
import { ClearableTextInput } from '../../../ClearableTextInput.js';
import { WELCOME_CONTROLS, useWelcomeControls } from './controls.js';
import type { ImportTarget } from '../00-preflight/logic.js';
import { overviewFor, toProjectPath } from './logic.js';

interface WelcomeScreenProps {
  target: ImportTarget;
  onContinue: (projectPath: string) => void;
  onQuit: () => void;
  initialPath?: string;
}

const OVERVIEW_BOX_MAX_WIDTH = 90;

const AI_MARKER = '✻';

const AI_DISCLOSURE = [
  'Steps marked ✻ use your local AI agent, which may send relevant code to your AI provider under your agreement with them. Contentful does not receive that code, or the prompts and responses. AI suggestions can be wrong or incomplete, so review and edit them before importing.',
];

export function WelcomeScreen({
  target,
  onContinue,
  onQuit,
  initialPath = '',
}: WelcomeScreenProps): React.ReactElement {
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
          {overviewFor(target).map((item, index) => (
            <Box key={item.description} gap={1}>
              <Box flexShrink={0}>
                <Text bold>Step {index + 1}</Text>
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

      <Box gap={3}>
        {WELCOME_CONTROLS.map((control) => (
          <Text key={control.keys}>
            [{control.keys}] {control.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

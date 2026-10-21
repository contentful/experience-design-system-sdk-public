import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../../../theme.js';

export interface OverviewStep {
  description: string;
  /** Whether the step uses the user's local AI agent. */
  ai: boolean;
}

const OVERVIEW_BOX_MAX_WIDTH = 90;

const AI_MARKER = '✻';

const AI_DISCLOSURE = [
  'Steps marked ✻ use your local AI agent, which may send relevant code to your AI provider under your agreement with them. Contentful does not receive that code, or the prompts and responses. AI suggestions can be wrong or incomplete, so review and edit them before importing.',
];

/** The framed list of the steps an import goes through, with the AI disclosure under it. Shown by the intro screens. */
export function OverviewBox({ steps }: { steps: readonly OverviewStep[] }): React.ReactElement {
  return (
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
        {steps.map((step, index) => (
          <Box key={step.description} gap={1}>
            <Box flexShrink={0}>
              <Text bold>Step {index + 1}</Text>
            </Box>
            <Text color={PALETTE.muted} wrap="truncate-end">
              {step.description}
            </Text>
            {step.ai && (
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
  );
}

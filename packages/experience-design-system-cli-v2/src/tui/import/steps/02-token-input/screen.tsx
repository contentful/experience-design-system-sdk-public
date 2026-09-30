import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../../../home/home.theme.js';
import { useBlinkingCursor } from '../../../use-blinking-cursor.js';
import { withCursor } from '../../input/line-editing.js';
import { TOKEN_INPUT_CONTROLS, useTokenInputControls } from './controls.js';
import { INITIAL_TOKEN_INPUT_STATE } from './logic.js';
import type { TokenInputScreenProps } from './types.js';

/**
 * Second page of the import flow. Render only: keyboard handling lives in `./controls.ts` and every decision in
 * `./logic.ts`. Reports the outcome through `onConfirm` / `onSkip` / `onQuit`; never exits the process itself.
 */
export function TokenInputScreen({ onConfirm, onSkip, onQuit }: TokenInputScreenProps): React.ReactElement {
  const [state, setState] = useState(INITIAL_TOKEN_INPUT_STATE);
  const cursorVisible = useBlinkingCursor();

  useTokenInputControls({ state, setState, onConfirm, onSkip, onQuit });

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text bold>Design tokens</Text>
      <Text dimColor>
        Point me to your raw token file (e.g. ~/design-tokens/tokens.json). You can use ~, relative, or absolute paths.
        Claude will map it to DTCG format.
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Box gap={1}>
          <Text color={PALETTE.accent}>?</Text>
          <Text>Token path (file or directory):</Text>
          <Text>{withCursor(state.value, cursorVisible)}</Text>
        </Box>
        {state.failure && (
          <Box flexDirection="column">
            <Text color={PALETTE.error}>✗ {state.failure.error}</Text>
            <Text dimColor> Resolved to: {state.failure.resolvedPath}</Text>
          </Box>
        )}
      </Box>

      <Box gap={3} marginTop={1}>
        {TOKEN_INPUT_CONTROLS.map((control) => (
          <Text key={control.keys} dimColor>
            [{control.keys}] {control.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

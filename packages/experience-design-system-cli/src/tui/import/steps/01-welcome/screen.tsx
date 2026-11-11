import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { startDebugRun, finishDebugRun } from '@tui/debug-store.js';
import type { ImportTarget } from '../00-preflight/logic.js';
import { ClearableTextInput } from '../../../shared/components/ClearableTextInput.js';
import { WELCOME_CONTROLS, useWelcomeControls } from './controls.js';
import { welcomeLog } from './log.js';
import { toProjectPath } from './logic.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';
import { StepHeader } from '@tui/shared/components/StepHeader.js';

interface WelcomeScreenProps {
  /** What the user chose to import at Preflight; it decides which steps run, so every log notes it. */
  mode: ImportTarget;
  onContinue: (projectPath: string) => void;
  onQuit: () => void;
  initialPath?: string;
}

export function WelcomeScreen({ mode, onContinue, onQuit, initialPath = '' }: WelcomeScreenProps): React.ReactElement {
  const [projectPath, setProjectPath] = useState(initialPath);
  // Enter on an empty field does nothing, which looks like a stuck screen, so the log counts it.
  const visit = useRef({ emptySubmits: 0 }).current;

  useEffect(() => {
    startDebugRun({ flow: 'import/welcome', step: '01-welcome', menuOption: 'Welcome' });
  }, []);

  const finish = (path: string | null): void => {
    const { summary, data } = welcomeLog({
      mode,
      projectPath: path,
      initialPath,
      emptySubmits: visit.emptySubmits,
    });
    void finishDebugRun({ summary, outputs: data, status: 'success', exitMethod: path ? 'saved' : 'discarded' });
  };

  const quit = () => {
    finish(null);
    onQuit();
  };

  useWelcomeControls(quit);

  const submit = (value: string) => {
    const path = toProjectPath(value);
    if (!path) {
      visit.emptySubmits += 1;
      return;
    }
    finish(path);
    onContinue(path);
  };

  return (
    <Box flexDirection="column">
      <StepHeader step="setup" />
      <Box flexDirection="column" gap={1} paddingX={2} paddingBottom={1}>
        <Box flexDirection="column" gap={1}>
          <Text color={PALETTE.text}>Where is your component library?</Text>
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

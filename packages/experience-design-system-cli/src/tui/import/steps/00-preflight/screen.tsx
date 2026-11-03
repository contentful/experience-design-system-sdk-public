import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { startDebugRun, finishDebugRun } from '@tui/debug-store.js';
import { PREFLIGHT_CONTROLS, usePreflightControls } from './controls.js';
import { IMPORT_TARGET_OPTIONS, overviewFor, type ImportTarget } from './logic.js';
import { OverviewBox } from '../../shared/index.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';
import { StepHeader } from '@tui/shared/components/StepHeader.js';

interface PreflightScreenProps {
  onChoose: (target: ImportTarget) => void;
  onQuit: () => void;
}

const optionAt = (index: number): ImportTarget => IMPORT_TARGET_OPTIONS[index]!.target;

export function PreflightScreen({ onChoose, onQuit }: PreflightScreenProps): React.ReactElement {
  const [focus, setFocus] = useState(0);
  // The options the user looked at on the way, in order, so the log shows what they compared before choosing.
  const viewed = useRef<ImportTarget[]>([optionAt(0)]).current;

  useEffect(() => {
    startDebugRun({
      flow: 'import/preflight',
      step: '00-preflight',
      menuOption: 'Preflight',
      inputs: { options: IMPORT_TARGET_OPTIONS.map((option) => option.target), initial_focus: optionAt(0) },
    });
  }, []);

  const moveTo = (next: number): void => {
    setFocus(next);
    if (viewed[viewed.length - 1] !== optionAt(next)) viewed.push(optionAt(next));
  };

  const choose = (target: ImportTarget): void => {
    void finishDebugRun({
      outputs: { chosen: target, viewed, steps_that_will_run: overviewFor(target).map((step) => step.description) },
      status: 'success',
      exitMethod: 'saved',
    });
    onChoose(target);
  };

  const quit = (): void => {
    void finishDebugRun({ outputs: { chosen: null, viewed }, status: 'success', exitMethod: 'discarded' });
    onQuit();
  };

  usePreflightControls({ focus, onFocus: moveTo, onChoose: choose, onQuit: quit });

  return (
    <Box flexDirection="column">
      <StepHeader step="setup" />
      <Box flexDirection="column" gap={1} paddingX={2} paddingBottom={1}>
        <Text bold color={PALETTE.text}>
          What do you want to import?
        </Text>
        <Box flexDirection="column">
          {IMPORT_TARGET_OPTIONS.map((option, index) => {
            const focused = index === focus;
            return (
              <Box key={option.target} gap={1}>
                <Text color={PALETTE.accent}>{focused ? '❯' : ' '}</Text>
                <Text bold={focused} color={focused ? PALETTE.accent : undefined}>
                  {option.label}
                </Text>
              </Box>
            );
          })}
        </Box>
        <OverviewBox steps={overviewFor(optionAt(focus))} />
        <ControlHints hints={PREFLIGHT_CONTROLS} />
      </Box>
    </Box>
  );
}

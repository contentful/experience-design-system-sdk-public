import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { startDebugRun, finishDebugRun } from '@tui/debug-store.js';
import { PREFLIGHT_CONTROLS, usePreflightControls } from './controls.js';
import { collectPreflightContext, preflightLog, type PreflightContext } from './log.js';
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
  // Collected while the user reads the screen. A choice made before it is ready is logged without it: the log is finished
  // at once, because the next step's log starts straight away and a late finish would land on that one.
  const context = useRef<PreflightContext | undefined>(undefined);

  useEffect(() => {
    startDebugRun({ flow: 'import/preflight', step: '00-preflight', menuOption: 'Preflight' });
    void collectPreflightContext().then((collected) => {
      context.current = collected;
    });
  }, []);

  const finish = (chosen: ImportTarget | null): void => {
    const { summary, data } = preflightLog(
      chosen,
      { columns: process.stdout.columns, rows: process.stdout.rows },
      context.current,
    );
    void finishDebugRun({ summary, outputs: data, status: 'success', exitMethod: chosen ? 'saved' : 'discarded' });
  };

  const choose = (target: ImportTarget): void => {
    finish(target);
    onChoose(target);
  };

  const quit = (): void => {
    finish(null);
    onQuit();
  };

  usePreflightControls({ focus, onFocus: setFocus, onChoose: choose, onQuit: quit });

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

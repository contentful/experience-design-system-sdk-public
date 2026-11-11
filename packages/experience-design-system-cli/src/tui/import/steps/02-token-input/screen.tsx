import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { startDebugRun, finishDebugRun } from '@tui/debug-store.js';
import type { ImportTarget } from '../00-preflight/logic.js';
import { ClearableTextInput } from '../../../shared/components/ClearableTextInput.js';
import { TOKEN_INPUT_CONTROLS, useTokenInputControls } from './controls.js';
import { tokenInputLog, type RejectedAttempt } from './log.js';
import { toTokenPath } from './logic.js';
import { validateTokenPath } from './validate-path.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';
import { StepHeader } from '@tui/shared/components/StepHeader.js';

interface TokenInputScreenProps {
  /** What the user chose to import at Preflight; it decides which steps run, so every log notes it. */
  mode: ImportTarget;
  onConfirm: (tokensPath: string) => void;
  onBack: () => void;
  initialPath?: string;
}

type Failure = { error: string; resolvedPath?: string };

// A long session of wrong paths must not make the log grow without bound.
const MAX_LOGGED_ATTEMPTS = 10;

export function TokenInputScreen({
  mode,
  onConfirm,
  onBack,
  initialPath = '',
}: TokenInputScreenProps): React.ReactElement {
  const [tokenPath, setTokenPath] = useState(initialPath);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Every path that was turned down, with the reason the user was shown, so "I could not get past this step" can be
  // read from the log.
  const rejected = useRef<RejectedAttempt[]>([]).current;
  // Enter on an empty field is counted, not listed: it names no path, and it can look like a stuck screen.
  const visit = useRef({ emptySubmits: 0 }).current;

  useEffect(() => {
    startDebugRun({ flow: 'import/token-input', step: '02-token-input', menuOption: 'Token input' });
  }, []);

  const finish = (tokenPath: string | null, enteredPath: string, endedOnError?: string): void => {
    const { summary, data } = tokenInputLog({
      mode,
      tokenPath,
      enteredPath,
      initialPath,
      rejected,
      emptySubmits: visit.emptySubmits,
      endedOnError,
    });
    void finishDebugRun({
      summary,
      outputs: data,
      status: endedOnError ? 'error' : 'success',
      exitMethod: tokenPath ? 'saved' : 'discarded',
    });
  };

  // Leaving with a path that was rejected and never fixed is the case worth flagging as an error.
  const back = () => {
    finish(null, tokenPath, failure?.error);
    onBack();
  };

  useTokenInputControls(back);

  const change = (value: string) => {
    setTokenPath(value);
    setFailure(null);
  };

  const reject = (entered: string, rejection: Failure) => {
    if (rejected.length < MAX_LOGGED_ATTEMPTS) {
      rejected.push({
        entered,
        error: rejection.error,
        ...(rejection.resolvedPath ? { resolved_path: rejection.resolvedPath } : {}),
      });
    }
    setFailure(rejection);
  };

  const submit = (value: string) => {
    const rawPath = toTokenPath(value);
    if (!rawPath) {
      visit.emptySubmits += 1;
      setFailure({ error: 'Enter the path to your token file.' });
      return;
    }
    const check = validateTokenPath(rawPath);
    if (!check.ok) {
      reject(rawPath, { error: check.error, resolvedPath: check.resolvedPath });
      return;
    }
    finish(check.path, rawPath);
    onConfirm(check.path);
  };

  return (
    <Box flexDirection="column">
      <StepHeader step="setup" />
      <Box flexDirection="column" gap={1} paddingX={2} paddingBottom={1}>
        <Text bold>Design tokens</Text>
        <Text color={PALETTE.muted}>
          Point me to your raw token file (e.g. ~/design-tokens/tokens.json). You can use ~, relative, or absolute
          paths. Claude will map it to Design Token Group Format (DTCG).
        </Text>

        <Box flexDirection="column">
          <Box gap={1}>
            <Text color={PALETTE.accent}>?</Text>
            <Text>Token path:</Text>
            <ClearableTextInput value={tokenPath} onChange={change} onSubmit={submit} />
          </Box>
          {failure && (
            <Box flexDirection="column">
              <Text color={PALETTE.error}>✗ {failure.error}</Text>
              {failure.resolvedPath && <Text color={PALETTE.muted}> Resolved to: {failure.resolvedPath}</Text>}
            </Box>
          )}
        </Box>

        <Box marginTop={1}>
          <ControlHints hints={TOKEN_INPUT_CONTROLS} />
        </Box>
      </Box>
    </Box>
  );
}

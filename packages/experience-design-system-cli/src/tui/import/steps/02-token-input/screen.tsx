import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { PALETTE } from '../../../home/home.theme.js';
import { TOKEN_INPUT_CONTROLS, useTokenInputControls } from './controls.js';
import { toTokenPath } from './logic.js';
import { validateTokenPath, type TokenPathFailure } from './validate-path.js';

interface TokenInputScreenProps {
  onConfirm: (tokensPath: string) => void;
  onSkip: () => void;
  onBack: () => void;
  initialPath?: string;
}

export function TokenInputScreen({
  onConfirm,
  onSkip,
  onBack,
  initialPath = '',
}: TokenInputScreenProps): React.ReactElement {
  const [tokenPath, setTokenPath] = useState(initialPath);
  const [failure, setFailure] = useState<TokenPathFailure | null>(null);

  useTokenInputControls(tokenPath, onSkip, onBack);

  const change = (value: string) => {
    setTokenPath(value);
    setFailure(null);
  };

  const submit = (value: string) => {
    const rawPath = toTokenPath(value);
    if (!rawPath) {
      onSkip();
      return;
    }
    const check = validateTokenPath(rawPath);
    if (check.ok) onConfirm(check.path);
    else setFailure({ error: check.error, resolvedPath: check.resolvedPath });
  };

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text bold>Design tokens</Text>
      <Text dimColor>
        Point me to your raw token file (e.g. ~/design-tokens/tokens.json). You can use ~, relative, or absolute paths.
        Claude will map it to Design Token Group Format (DTCG).
      </Text>

      <Box flexDirection="column">
        <Box gap={1}>
          <Text color={PALETTE.accent}>?</Text>
          <Text>Token path:</Text>
          <TextInput value={tokenPath} onChange={change} onSubmit={submit} />
        </Box>
        {failure && (
          <Box flexDirection="column">
            <Text color={PALETTE.error}>✗ {failure.error}</Text>
            <Text dimColor> Resolved to: {failure.resolvedPath}</Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1} gap={3}>
        {TOKEN_INPUT_CONTROLS.map((control) => (
          <Text key={control.keys} dimColor>
            [{control.keys}] {control.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';

type Field = 'spaceId' | 'environmentId' | 'cmaToken' | 'host';

type CredentialsStepProps = {
  summary?: string;
  error?: string;
  initialSpaceId?: string;
  initialEnvironmentId?: string;
  initialCmaToken?: string;
  initialHost?: string;
  /** Called when the user submits with all fields changed from their initial values */
  onConfirm: (spaceId: string, environmentId: string, cmaToken: string, host: string) => void;
  /** Called when the user submits without changing any field (use existing creds as-is) */
  onContinue?: (spaceId: string, environmentId: string, cmaToken: string, host: string) => void;
  onQuit: () => void;
};

export function CredentialsStep({
  summary,
  error: externalError,
  initialSpaceId = '',
  initialEnvironmentId = 'master',
  initialCmaToken = '',
  initialHost = '',
  onConfirm,
  onContinue,
  onQuit,
}: CredentialsStepProps): React.ReactElement {
  const [spaceId, setSpaceId] = useState(initialSpaceId);
  const [environmentId, setEnvironmentId] = useState(initialEnvironmentId);
  const [cmaToken, setCmaToken] = useState(initialCmaToken);
  const [host, setHost] = useState(initialHost);
  const [activeField, setActiveField] = useState<Field>('spaceId');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => setCursorVisible((v) => !v), 500);
    return () => clearInterval(interval);
  }, []);

  useImmediateInput((input, key) => {
    if (key.return) {
      if (activeField === 'spaceId') {
        setActiveField('environmentId');
        return;
      }
      if (activeField === 'environmentId') {
        setActiveField('cmaToken');
        return;
      }
      if (activeField === 'cmaToken') {
        setActiveField('host');
        return;
      }
      // Submit
      if (!spaceId.trim() || !environmentId.trim() || !cmaToken.trim()) {
        setInlineError('All fields are required.');
        return;
      }
      setInlineError(null);
      const unchanged =
        spaceId.trim() === initialSpaceId &&
        environmentId.trim() === initialEnvironmentId &&
        cmaToken.trim() === initialCmaToken &&
        host.trim() === initialHost;
      if (unchanged && onContinue) {
        onContinue(spaceId.trim(), environmentId.trim(), cmaToken.trim(), host.trim());
      } else {
        onConfirm(spaceId.trim(), environmentId.trim(), cmaToken.trim(), host.trim());
      }
      return;
    }
    if (key.tab) {
      setActiveField((f) =>
        f === 'spaceId' ? 'environmentId' : f === 'environmentId' ? 'cmaToken' : f === 'cmaToken' ? 'host' : 'spaceId',
      );
      return;
    }
    if (key.escape || input === 'q') {
      onQuit();
      return;
    }
    if (key.backspace || key.delete) {
      if (activeField === 'spaceId') setSpaceId((v) => v.slice(0, -1));
      else if (activeField === 'environmentId') setEnvironmentId((v) => v.slice(0, -1));
      else if (activeField === 'cmaToken') setCmaToken((v) => v.slice(0, -1));
      else setHost((v) => v.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      if (activeField === 'spaceId') setSpaceId((v) => v + input);
      else if (activeField === 'environmentId') setEnvironmentId((v) => v + input);
      else if (activeField === 'cmaToken') setCmaToken((v) => v + input);
      else setHost((v) => v + input);
    }
  });

  const cursor = cursorVisible ? '█' : ' ';

  function renderField(label: string, value: string, field: Field, masked = false) {
    const isActive = activeField === field;
    const display = masked ? '•'.repeat(value.length) : value;
    return (
      <Box gap={1}>
        <Text color={isActive ? 'cyan' : undefined}>{'?'}</Text>
        <Text bold={isActive}>{label}:</Text>
        <Text>{isActive ? display + cursor : display || <Text dimColor>(empty)</Text>}</Text>
      </Box>
    );
  }

  const displayError = inlineError ?? externalError ?? null;

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      {summary && <Text color="green">✓ {summary}</Text>}

      <Box marginTop={1}>
        <Text>
          {initialSpaceId && initialCmaToken
            ? 'Credentials pre-filled from experiences setup. Press Enter to continue or edit any field to update.'
            : 'Enter your Contentful credentials to continue.'}
        </Text>
      </Box>
      {!(initialSpaceId && initialCmaToken) && (
        <Text dimColor>
          Tip: run experiences setup to save these to ~/.config/experiences/credentials.json so they pre-fill here
          automatically.
        </Text>
      )}

      <Box flexDirection="column" gap={0} marginTop={1}>
        {renderField('Space ID', spaceId, 'spaceId')}
        {renderField('Environment', environmentId, 'environmentId')}
        {renderField('CMA Token', cmaToken, 'cmaToken', true)}
        {renderField('API Host', host, 'host')}
      </Box>
      {activeField === 'host' && (
        <Text dimColor>Leave blank for api.contentful.com · EU spaces: https://api.eu.contentful.com</Text>
      )}

      {displayError && <Text color="red">✗ {displayError}</Text>}

      <Box gap={3} marginTop={1}>
        <Text dimColor>[Enter] Next field / Submit</Text>
        <Text dimColor>[Tab] Switch field</Text>
        <Text dimColor>[q] Quit</Text>
      </Box>
    </Box>
  );
}

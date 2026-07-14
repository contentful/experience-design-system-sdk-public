import React, { useState, useEffect, useRef } from 'react';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';
import { DEFAULT_CONFIGURED_HOST, toConfiguredHost } from '../../../host-utils.js';

type Field = 'spaceId' | 'environmentId' | 'cmaToken' | 'host';

type CredentialsStepProps = {
  summary?: string;
  error?: string;
  initialSpaceId?: string;
  initialEnvironmentId?: string;
  initialCmaToken?: string;
  initialHost?: string;
  /**
   * When true, the credentials screen stays mounted but locks input and shows
   * an inline "Validating credentials..." status. Replaces the previous
   * dedicated `validating-credentials` render screen so the operator sees a
   * continuous credentials surface instead of a transient loading screen
   * (Change 1 of the wizard prefetch refactor).
   */
  validating?: boolean;
  /** Inline status describing in-flight background generation prefetch. */
  generatePrefetchStatus?: 'idle' | 'running' | 'complete' | 'failed';
  /** Error message from a failed generation prefetch (rendered as a banner). */
  generatePrefetchError?: string | null;
  /** Called when the user submits with any field changed from its initial value */
  onConfirm: (spaceId: string, environmentId: string, cmaToken: string, host: string) => void;
  /** Called when the user submits without changing any field (use existing creds as-is) */
  onContinue?: (spaceId: string, environmentId: string, cmaToken: string, host: string) => void;
  onQuit: () => void;
  /**
   * Optional retry callback wired up when a background generation prefetch
   * failed mid-credentials-entry. The operator presses R to re-trigger.
   */
  onRetryPrefetch?: () => void;
  /**
   * Skip-credentials escape hatch. When pressed (via `s` keybind, gated
   * against text-entry mode), the wizard advances without validating
   * credentials and disables push downstream. See dsi-tui-skip-credentials
   * spec.
   */
  onSkip?: () => void;
};

export function CredentialsStep({
  summary,
  error: externalError,
  initialSpaceId = '',
  initialEnvironmentId = 'master',
  initialCmaToken = '',
  initialHost,
  validating = false,
  generatePrefetchStatus = 'idle',
  generatePrefetchError = null,
  onConfirm,
  onContinue,
  onQuit,
  onRetryPrefetch,
  onSkip,
}: CredentialsStepProps): React.ReactElement {
  const normalizedInitialHost = toConfiguredHost(initialHost) ?? DEFAULT_CONFIGURED_HOST;
  const [spaceId, setSpaceId] = useState(initialSpaceId);
  const [environmentId, setEnvironmentId] = useState(initialEnvironmentId);
  const [cmaToken, setCmaToken] = useState(initialCmaToken);
  const [host, setHost] = useState(normalizedInitialHost);
  const [activeField, setActiveField] = useState<Field>('spaceId');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [cursorVisible, setCursorVisible] = useState(true);
  // Tracks whether the operator has typed any printable character into a
  // form field since mount. While false, the `s` keybind is interpreted as
  // the skip-credentials shortcut. Once the operator has begun typing, `s`
  // is routed into the active field as input (we don't want to swallow a
  // legitimate letter in a space ID / token / host).
  const hasTypedRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => setCursorVisible((v) => !v), 500);
    return () => clearInterval(interval);
  }, []);

  useImmediateInput((input, key) => {
    // While we are validating credentials, the screen stays mounted but the
    // form is locked — any input is dropped. The exception is `R` when a
    // prefetch failed and we expose a retry hook (so the operator can recover
    // without backing out of the wizard).
    if (validating) {
      return;
    }
    if ((input === 'r' || input === 'R') && generatePrefetchStatus === 'failed' && onRetryPrefetch) {
      onRetryPrefetch();
      return;
    }
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
      const submittedHost = toConfiguredHost(host) ?? DEFAULT_CONFIGURED_HOST;
      const unchanged =
        spaceId.trim() === initialSpaceId &&
        environmentId.trim() === initialEnvironmentId &&
        cmaToken.trim() === initialCmaToken &&
        submittedHost === normalizedInitialHost;
      if (unchanged && onContinue) {
        onContinue(spaceId.trim(), environmentId.trim(), cmaToken.trim(), submittedHost);
      } else {
        onConfirm(spaceId.trim(), environmentId.trim(), cmaToken.trim(), submittedHost);
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
    // Skip-credentials shortcut. Gated against text-entry mode so the letter
    // 's' can still be typed into a form field once the operator has begun
    // editing. The legend hint is always rendered (see below) so operators
    // know the escape hatch exists from the moment the screen mounts.
    if ((input === 's' || input === 'S') && onSkip && !hasTypedRef.current) {
      onSkip();
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
      hasTypedRef.current = true;
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
    const fallback = field === 'host' ? DEFAULT_CONFIGURED_HOST : <Text dimColor>(empty)</Text>;
    return (
      <Box gap={1}>
        <Text color={isActive ? PALETTE.info : undefined}>{'?'}</Text>
        <Text bold={isActive}>{label}:</Text>
        <Text>{isActive ? display + cursor : display || fallback}</Text>
      </Box>
    );
  }

  const displayError = inlineError ?? externalError ?? null;

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      {summary && <Text color={PALETTE.success}>✓ {summary}</Text>}

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
      {activeField === 'host' && <Text dimColor>Default: api.contentful.com · EU spaces: api.eu.contentful.com</Text>}

      {displayError && <Text color={PALETTE.error}>✗ {displayError}</Text>}

      {validating && (
        <Text color={PALETTE.info}>
          {generatePrefetchStatus === 'running'
            ? 'Validating credentials & finishing component generation...'
            : 'Validating credentials...'}
        </Text>
      )}

      {!validating && generatePrefetchStatus === 'running' && <Text dimColor>Component generation in progress...</Text>}
      {!validating && generatePrefetchStatus === 'complete' && (
        <Text color={PALETTE.success}>Component generation complete.</Text>
      )}
      {!validating && generatePrefetchStatus === 'failed' && (
        <Text color={PALETTE.warning}>
          Component generation failed
          {generatePrefetchError ? `: ${generatePrefetchError}` : ''}. Will retry after credential validation.
          {onRetryPrefetch ? ' Press R to retry now.' : ''}
        </Text>
      )}

      <Box gap={3} marginTop={1}>
        <Text dimColor>[Enter] Next field / Submit</Text>
        <Text dimColor>[Tab] Switch field</Text>
        <Text dimColor>[q] Quit</Text>
      </Box>
      {onSkip && (
        <Box marginTop={0}>
          <Text dimColor>[s] Skip — review locally only (no push, no live preview)</Text>
        </Box>
      )}
    </Box>
  );
}

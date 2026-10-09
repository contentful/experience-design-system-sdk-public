import React, { useRef, useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { PALETTE } from '../../../home/home.theme.js';
import { CREDENTIALS_CONTROLS, useCredentialsControls } from './controls.js';
import {
  DEFAULT_HOST,
  FIELDS,
  isUnchanged,
  missingField,
  nextField,
  normalize,
  type CredentialField,
  type CredentialValues,
} from './logic.js';
import { validateCredentials, type ValidationResult } from './validate.js';

export type CredentialsResult = { skipped: false; credentials: CredentialValues } | { skipped: true };

interface CredentialsScreenProps {
  onDone: (result: CredentialsResult) => void;
  onBack: () => void;
  initial?: Partial<CredentialValues>;
  validate?: (values: CredentialValues) => Promise<ValidationResult>;
}

const LABELS: Record<CredentialField, string> = {
  spaceId: 'Space ID',
  environmentId: 'Environment',
  cmaToken: 'CMA Token',
  host: 'API Host',
};

export function CredentialsScreen({
  onDone,
  onBack,
  initial = {},
  validate = validateCredentials,
}: CredentialsScreenProps): React.ReactElement {
  const initialValues = useRef(
    normalize({
      spaceId: initial.spaceId ?? '',
      environmentId: initial.environmentId || 'master',
      cmaToken: initial.cmaToken ?? '',
      host: initial.host ?? '',
    }),
  ).current;
  const [values, setValues] = useState<CredentialValues>(initialValues);
  const [active, setActive] = useState<CredentialField>('spaceId');
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const prefilled = initialValues.spaceId !== '' && initialValues.cmaToken !== '';

  useCredentialsControls({
    disabled: validating,
    onBack,
    onNextField: () => setActive(nextField),
    onSkip: () => onDone({ skipped: true }),
  });

  const change = (field: CredentialField) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setError(null);
  };

  const submit = async (field: CredentialField) => {
    if (field !== 'host') {
      setActive(nextField(field));
      return;
    }
    const credentials = normalize(values);
    if (missingField(credentials)) {
      setError('Space ID, environment and CMA token are all required.');
      return;
    }
    setValidating(true);
    const result = await validate(credentials);
    setValidating(false);
    if (result.ok) onDone({ skipped: false, credentials });
    else setError(result.error);
  };

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Box flexDirection="column">
        <Text bold>Contentful credentials</Text>
        <Text>
          {prefilled
            ? 'Credentials pre-filled from the configuration settings.'
            : 'Enter the Contentful space you want to import into.'}
        </Text>
        {!prefilled && (
          <>
            <Text dimColor>
              We use it to check what components already exist and to push your import. If you skip, files are saved
              locally and nothing is pushed.
            </Text>
            <Text dimColor>Tip: save these under Settings → Configuration so they pre-fill here.</Text>
          </>
        )}
      </Box>

      <Box flexDirection="column">
        {FIELDS.map((field) => (
          <Box key={field} gap={1}>
            <Text color={active === field ? PALETTE.accent : undefined}>?</Text>
            <Text bold={active === field}>{LABELS[field]}:</Text>
            <TextInput
              value={values[field]}
              focus={active === field && !validating}
              mask={field === 'cmaToken' ? '•' : undefined}
              placeholder={field === 'host' ? DEFAULT_HOST : undefined}
              onChange={change(field)}
              onSubmit={() => void submit(field)}
            />
          </Box>
        ))}
      </Box>
      {active === 'host' && <Text dimColor>Default: api.contentful.com · EU spaces: api.eu.contentful.com</Text>}

      {error && <Text color={PALETTE.error}>✗ {error}</Text>}
      {validating && <Text color={PALETTE.accent}>Validating credentials...</Text>}
      {!validating && !error && !isUnchanged(normalize(values), initialValues) && (
        <Text dimColor>Changed values are saved after they validate.</Text>
      )}

      <Box marginTop={1} gap={3}>
        {CREDENTIALS_CONTROLS.map((control) => (
          <Text key={control.keys} dimColor>
            [{control.keys}] {control.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

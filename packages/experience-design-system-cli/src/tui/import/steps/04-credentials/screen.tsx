import React, { useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { SetupForm, type SetupField, type SetupMenuItem } from '@tui/shared/components/SetupForm.js';
import {
  credentialsPurpose,
  isUnchanged,
  missingField,
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
  /** The import only generates tokens, so there are no components to look up in the space. */
  tokensOnly?: boolean;
}

const FIELDS: readonly SetupField<CredentialField>[] = [
  { key: 'spaceId', label: 'Space ID' },
  { key: 'environmentId', label: 'Environment ID' },
  { key: 'cmaToken', label: 'CMA Token', masked: true },
  { key: 'host', label: 'API Host', hint: '(default: api.contentful.com · EU spaces: api.eu.contentful.com)' },
];

type MenuChoice = 'continue' | 'edit' | 'skip' | 'back';

const MENU: readonly SetupMenuItem<MenuChoice>[] = [
  { choice: 'continue', label: 'Continue', description: 'Check the credentials and go on' },
  { choice: 'edit', label: 'Edit', description: 'Change the credentials' },
  { choice: 'skip', label: 'Skip', description: 'Save files only, nothing is pushed' },
  { choice: 'back', label: 'Back', description: 'Go back' },
];

export function CredentialsScreen({
  onDone,
  onBack,
  initial = {},
  validate = validateCredentials,
  tokensOnly = false,
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
  const [saved, setSaved] = useState<CredentialValues>(initialValues);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const prefilled = initialValues.spaceId !== '' && initialValues.cmaToken !== '';

  const submit = async (): Promise<void> => {
    const credentials = normalize(saved);
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
    <SetupForm
      title="Contentful Credentials"
      subtitle={
        prefilled
          ? 'Credentials pre-filled from the configuration settings.'
          : 'Enter the Contentful space you want to import into.'
      }
      menu={MENU}
      dataTitle="Space"
      fields={FIELDS}
      values={values}
      // With nothing pre-filled there is nothing to review, so it opens ready to type.
      initialEditing={!prefilled}
      onChange={(key, value) => {
        setValues((current) => ({ ...current, [key]: value }));
        setError(null);
      }}
      onEditStart={() => setError(null)}
      onCommit={() => setSaved(values)}
      onCancel={() => {
        setValues(saved);
        setError(null);
      }}
      onChoose={(choice) => {
        if (choice === 'continue') void submit();
        else if (choice === 'skip') onDone({ skipped: true });
        else onBack();
      }}
      onEscape={onBack}
      busy={validating}
    >
      {error && (
        <Box marginTop={1}>
          <Text color={PALETTE.error}>✗ {error}</Text>
        </Box>
      )}
      {validating && (
        <Box marginTop={1}>
          <Text color={PALETTE.accent}>Validating credentials...</Text>
        </Box>
      )}
      {!prefilled && !error && !validating && (
        <Box marginTop={1} flexDirection="column">
          <Text color={PALETTE.muted}>{credentialsPurpose(tokensOnly)}</Text>
          <Text color={PALETTE.muted}>Tip: save these under Settings → Configuration so they pre-fill here.</Text>
        </Box>
      )}
      {!error && !validating && !isUnchanged(normalize(saved), initialValues) && (
        <Box marginTop={1}>
          <Text color={PALETTE.muted}>Changed values are saved after they validate.</Text>
        </Box>
      )}
    </SetupForm>
  );
}

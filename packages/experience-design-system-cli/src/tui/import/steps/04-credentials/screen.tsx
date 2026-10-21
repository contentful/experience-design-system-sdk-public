import React, { useRef, useState } from 'react';
import { Text } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { FieldForm, type FormField, type FormNotice } from '@tui/shared/components/FieldForm.js';
import { StepHeader } from '@tui/shared/components/StepHeader.js';
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

const FIELDS: readonly FormField<CredentialField>[] = [
  { key: 'spaceId', label: 'Space ID' },
  { key: 'environmentId', label: 'Environment ID' },
  { key: 'cmaToken', label: 'CMA Token', masked: true },
  { key: 'host', label: 'API Host', hint: '(default: api.contentful.com · EU spaces: api.eu.contentful.com)' },
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
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [validating, setValidating] = useState(false);
  const prefilled = initialValues.spaceId !== '' && initialValues.cmaToken !== '';

  const submit = async (): Promise<void> => {
    const credentials = normalize(values);
    if (missingField(credentials)) {
      setNotice({ kind: 'error', text: 'Space ID, environment and CMA token are all required.' });
      return;
    }
    setValidating(true);
    const result = await validate(credentials);
    setValidating(false);
    if (result.ok) onDone({ skipped: false, credentials });
    else setNotice({ kind: 'error', text: result.error });
  };

  return (
    <FieldForm
      header={<StepHeader step="setup" />}
      title="Contentful Credentials"
      subtitle={
        prefilled
          ? 'Credentials pre-filled from the configuration settings.'
          : 'Enter the Contentful space you want to import into.'
      }
      fields={FIELDS}
      values={values}
      onChange={(key, value) => {
        setValues((current) => ({ ...current, [key]: value }));
        setNotice(null);
      }}
      actions={[
        {
          label: 'Continue',
          description: 'Check the credentials and go on',
          runningText: 'Validating credentials...',
          running: validating,
          hint: 'continue',
          onRun: () => void submit(),
        },
        {
          label: 'Skip',
          description: 'Save files only, nothing is pushed',
          hint: 'skip',
          onRun: () => onDone({ skipped: true }),
        },
      ]}
      onSave={() => void submit()}
      saveLabel="continue"
      onQuit={onBack}
      quitLabel="back"
      notice={notice}
      busy={validating}
    >
      {!prefilled && (
        <>
          <Text> </Text>
          <Text color={PALETTE.muted}>{credentialsPurpose(tokensOnly)}</Text>
          <Text color={PALETTE.muted}>Tip: save these under Settings → Configuration so they pre-fill here.</Text>
        </>
      )}
      {!validating && !notice && !isUnchanged(normalize(values), initialValues) && (
        <>
          <Text> </Text>
          <Text color={PALETTE.muted}>Changed values are saved after they validate.</Text>
        </>
      )}
    </FieldForm>
  );
}

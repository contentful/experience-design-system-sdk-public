import React, { useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '@tui/theme.js';
import {
  FieldForm,
  FormReadOnlyRow,
  formLabelWidth,
  type FormField,
  type FormNotice,
} from '@tui/shared/components/FieldForm.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';
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

// Esc is the way back, so there is no Quit row; it still reports as 'quit'.
type MenuChoice = 'continue' | 'edit' | 'quit';

const MENU: readonly { choice: MenuChoice; label: string; description: string }[] = [
  { choice: 'continue', label: 'Continue', description: 'Check the credentials and go on' },
  { choice: 'edit', label: 'Edit', description: 'Change the credentials' },
];

interface CredentialsReviewProps {
  values: CredentialValues;
  subtitle: string;
  notice: FormNotice | null;
  validating: boolean;
  onChoose: (choice: MenuChoice) => void;
  children?: React.ReactNode;
}

/** The credentials as read-only text with a menu above them, so Enter on Continue is all it takes to go on. */
function CredentialsReview({
  values,
  subtitle,
  notice,
  validating,
  onChoose,
  children,
}: CredentialsReviewProps): React.ReactElement {
  const [focus, setFocus] = useState(0);

  useInput((_input, key) => {
    if (validating) return;
    if (key.escape) onChoose('quit');
    else if (key.return) onChoose(MENU[focus]!.choice);
    else if (key.upArrow) setFocus((current) => (current - 1 + MENU.length) % MENU.length);
    else if (key.downArrow || key.tab) setFocus((current) => (current + 1) % MENU.length);
  });

  const labelWidth = formLabelWidth([...FIELDS, ...MENU]);

  return (
    <Box flexDirection="column">
      <StepHeader step="setup" />
      <Box flexDirection="column" paddingX={2} paddingBottom={1}>
        <Text bold>Contentful Credentials</Text>
        <Text> </Text>
        <Text color={PALETTE.muted}>{subtitle}</Text>
        <Text> </Text>
        <Text bold color={PALETTE.accent}>
          ACTIONS
        </Text>
        {MENU.map((item, index) => {
          const focused = index === focus;
          return (
            <Box key={item.choice} gap={1}>
              <Text color={focused ? PALETTE.accent : undefined}>{focused ? '❯' : ' '}</Text>
              <Box width={labelWidth} flexShrink={0}>
                <Text bold={focused} color={focused ? PALETTE.accent : PALETTE.text}>
                  {item.label}
                </Text>
              </Box>
              <Text color={PALETTE.muted}>{item.description}</Text>
            </Box>
          );
        })}
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="single"
          borderColor={PALETTE.border}
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
        >
          <Text bold color={PALETTE.muted}>
            SPACE
          </Text>
          {FIELDS.map((field) => {
            const value = values[field.key];
            return (
              <FormReadOnlyRow key={field.key} label={field.label} labelWidth={labelWidth}>
                <Text color={value ? PALETTE.text : PALETTE.muted}>
                  {field.masked ? '•'.repeat(value.length) : value || '(empty)'}
                </Text>
              </FormReadOnlyRow>
            );
          })}
        </Box>
        {notice && (
          <>
            <Text> </Text>
            <Text color={PALETTE.error}>✗ {notice.text}</Text>
          </>
        )}
        {validating && (
          <>
            <Text> </Text>
            <Text color={PALETTE.accent}>Validating credentials...</Text>
          </>
        )}
        {children}
        <Text> </Text>
        <ControlHints
          hints={[
            { keys: '↑/↓', label: 'move' },
            { keys: '⏎', label: MENU[focus]!.label.toLowerCase() },
            { keys: 'Esc', label: 'back' },
          ]}
        />
      </Box>
    </Box>
  );
}

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
  // Prefilled credentials open read-only with the menu. With nothing to review, go straight to filling them in.
  const [editing, setEditing] = useState(!prefilled);

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

  const subtitle = prefilled
    ? 'Credentials pre-filled from the configuration settings.'
    : 'Enter the Contentful space you want to import into.';

  const choose = (choice: MenuChoice): void => {
    if (choice === 'continue') void submit();
    else if (choice === 'edit') {
      setNotice(null);
      setEditing(true);
    } else onBack();
  };

  if (!editing) {
    return (
      <CredentialsReview values={values} subtitle={subtitle} notice={notice} validating={validating} onChoose={choose}>
        {!isUnchanged(normalize(values), initialValues) && (
          <>
            <Text> </Text>
            <Text color={PALETTE.muted}>Changed values are saved after they validate.</Text>
          </>
        )}
      </CredentialsReview>
    );
  }

  return (
    <FieldForm
      header={<StepHeader step="setup" />}
      title="Contentful Credentials"
      subtitle={subtitle}
      fields={FIELDS}
      values={values}
      onChange={(key, value) => {
        setValues((current) => ({ ...current, [key]: value }));
        setNotice(null);
      }}
      enterAdvances
      onSave={() => void submit()}
      saveLabel="continue"
      // With nothing prefilled there is no review to return to, so Esc leaves the step.
      onQuit={prefilled ? () => setEditing(false) : onBack}
      quitLabel={prefilled ? 'stop editing' : 'back'}
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
      {validating && (
        <>
          <Text> </Text>
          <Text color={PALETTE.accent}>Validating credentials...</Text>
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

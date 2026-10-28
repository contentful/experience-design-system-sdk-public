import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { startDebugRun, finishDebugRun } from '@tui/debug-store.js';
import type { ImportTarget } from '../00-preflight/logic.js';
import { formLabelWidth, type FormField, type FormNotice } from '@tui/shared/components/FieldForm.js';
import { ClearableTextInput } from '@tui/shared/components/ClearableTextInput.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';
import { StepHeader } from '@tui/shared/components/StepHeader.js';
import {
  credentialsLog,
  credentialsOutputs,
  credentialsPurpose,
  isUnchanged,
  missingFields,
  normalize,
  rejectedAttempt,
  type CredentialAttempt,
  type CredentialField,
  type CredentialValues,
} from './logic.js';
import { validateCredentials, type ValidationResult } from './validate.js';

export type CredentialsResult = { skipped: false; credentials: CredentialValues } | { skipped: true };

interface CredentialsScreenProps {
  /** What the user chose to import at Preflight; it decides which steps run, so every log notes it. */
  mode: ImportTarget;
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

// A long session of wrong credentials must not make the log grow without bound.
const MAX_LOGGED_ATTEMPTS = 10;

export function CredentialsScreen({
  mode,
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
  // One screen throughout. The cursor is either in the menu on top or in the fields below it; with nothing pre-filled
  // there is nothing to review, so it starts in the fields.
  const [editing, setEditing] = useState(!prefilled);
  const [focus, setFocus] = useState(0);
  const [active, setActive] = useState(0);
  const [beforeEdit, setBeforeEdit] = useState(initialValues);
  // Every attempt that was turned down, already scrubbed of the token, so "I could not get past credentials" can be read
  // from the log. `lastReason` is kept apart because the list stops growing at the cap.
  const visit = useRef({ attempts: [] as CredentialAttempt[], lastReason: '' }).current;

  useEffect(() => {
    startDebugRun({
      flow: 'import/credentials',
      step: '04-credentials',
      menuOption: 'Credentials',
      inputs: { import_mode: mode, prefilled, ...credentialsLog(initialValues) },
    });
  }, []);

  const reject = (attempt: CredentialAttempt, text: string): void => {
    if (visit.attempts.length < MAX_LOGGED_ATTEMPTS) visit.attempts.push(attempt);
    visit.lastReason = attempt.reason;
    setNotice({ kind: 'error', text });
  };

  // Leaving with a rejection that was never fixed is the case worth flagging as an error.
  const leave = (): void => {
    void finishDebugRun({
      outputs: {
        ...credentialsOutputs({
          outcome: 'back',
          credentials: normalize(values),
          initial: initialValues,
          attempts: visit.attempts,
        }),
        ...(notice ? { error: visit.lastReason } : {}),
      },
      status: notice ? 'error' : 'success',
      exitMethod: 'discarded',
    });
    onBack();
  };

  const submit = async (): Promise<void> => {
    const credentials = normalize(values);
    const missing = missingFields(credentials);
    if (missing.length > 0) {
      reject(
        rejectedAttempt(`Missing required fields: ${missing.join(', ')}`, credentials),
        'Space ID, environment and CMA token are all required.',
      );
      return;
    }
    setValidating(true);
    const result = await validate(credentials);
    setValidating(false);
    if (!result.ok) {
      reject(rejectedAttempt(result.error, credentials), result.error);
      return;
    }
    void finishDebugRun({
      outputs: credentialsOutputs({
        outcome: 'validated',
        credentials,
        initial: initialValues,
        attempts: visit.attempts,
      }),
      status: 'success',
      exitMethod: 'saved',
    });
    onDone({ skipped: false, credentials });
  };

  const choose = (choice: MenuChoice): void => {
    if (choice === 'continue') void submit();
    else if (choice === 'edit') {
      setNotice(null);
      setBeforeEdit(values);
      setActive(0);
      setEditing(true);
    } else leave();
  };

  // Saves what was typed and puts the cursor back on the first menu item.
  const stopEditing = (): void => {
    setEditing(false);
    setFocus(0);
  };

  useInput((_input, key) => {
    if (validating) return;
    if (editing) {
      if (key.escape) {
        // With nothing pre-filled there is no menu view to return to, so Esc leaves the step.
        if (!prefilled) leave();
        else {
          setValues(beforeEdit);
          setNotice(null);
          stopEditing();
        }
      } else if (key.upArrow) setActive((current) => (current - 1 + FIELDS.length) % FIELDS.length);
      else if (key.downArrow || key.tab) setActive((current) => (current + 1) % FIELDS.length);
      return;
    }
    if (key.escape) choose('quit');
    else if (key.return) choose(MENU[focus]!.choice);
    else if (key.upArrow) setFocus((current) => (current - 1 + MENU.length) % MENU.length);
    else if (key.downArrow || key.tab) setFocus((current) => (current + 1) % MENU.length);
  });

  const labelWidth = formLabelWidth([...FIELDS, ...MENU]);
  const changed = !isUnchanged(normalize(values), initialValues);

  return (
    <Box flexDirection="column">
      <StepHeader step="setup" />
      <Box flexDirection="column" paddingX={2} paddingBottom={1}>
        <Text bold color={PALETTE.accent}>
          Contentful Credentials
        </Text>
        <Text> </Text>
        <Text color={PALETTE.muted}>
          {prefilled
            ? 'Credentials pre-filled from the configuration settings.'
            : 'Enter the Contentful space you want to import into.'}
        </Text>
        <Text> </Text>
        <Text color={PALETTE.muted}>Actions</Text>
        {MENU.map((item, index) => {
          const focused = !editing && index === focus;
          return (
            <Box key={item.choice} gap={1}>
              <Text color={PALETTE.accent}>{focused ? '❯' : ' '}</Text>
              <Box width={labelWidth} flexShrink={0}>
                <Text bold={focused} color={focused ? PALETTE.accent : editing ? PALETTE.muted : PALETTE.text}>
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
          <Text color={PALETTE.muted}>Space</Text>
          {FIELDS.map((field, index) => {
            const open = editing && index === active;
            const value = values[field.key];
            const display = field.masked ? '•'.repeat(value.length) : value;
            return (
              <Box key={field.key} gap={1}>
                <Text color={PALETTE.accent}>{open ? '❯' : ' '}</Text>
                <Box width={labelWidth} flexShrink={0}>
                  <Text bold={open} color={open ? PALETTE.accent : PALETTE.muted}>
                    {field.label}
                  </Text>
                </Box>
                {open ? (
                  <ClearableTextInput
                    value={value}
                    onChange={(next) => {
                      setValues((current) => ({ ...current, [field.key]: next }));
                      setNotice(null);
                    }}
                    onSubmit={stopEditing}
                    mask={field.masked ? '•' : undefined}
                  />
                ) : (
                  <Text color={display ? PALETTE.text : PALETTE.muted}>{display || (field.hint ?? '(empty)')}</Text>
                )}
              </Box>
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
        {!prefilled && !validating && !notice && (
          <>
            <Text> </Text>
            <Text color={PALETTE.muted}>{credentialsPurpose(tokensOnly)}</Text>
            <Text color={PALETTE.muted}>Tip: save these under Settings → Configuration so they pre-fill here.</Text>
          </>
        )}
        {changed && !validating && !notice && (
          <>
            <Text> </Text>
            <Text color={PALETTE.muted}>Changed values are saved after they validate.</Text>
          </>
        )}
        {editing && (
          <>
            <Text> </Text>
            <ControlHints
              hints={[
                { keys: '↑/↓', label: 'field' },
                { keys: '⏎', label: 'save' },
                { keys: 'Ctrl+D', label: 'clear' },
                { keys: 'Esc', label: prefilled ? 'cancel' : 'back' },
              ]}
            />
          </>
        )}
      </Box>
    </Box>
  );
}

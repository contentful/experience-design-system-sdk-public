import React, { useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { formLabelWidth, type FormField, type FormNotice } from '@tui/shared/components/FieldForm.js';
import { ClearableTextInput } from '@tui/shared/components/ClearableTextInput.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';
import { StepHeader } from '@tui/shared/components/StepHeader.js';
import { useTerminalWidth } from '@tui/use-terminal-width.js';
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

/** A section label drawn as a faint rule with the name inline, such as "── Actions ────────", so it reads as a divider. */
function SectionLabel({ label, active = false }: { label: string; active?: boolean }): React.ReactElement {
  const columns = useTerminalWidth();
  const rule = '─'.repeat(Math.max(2, columns - label.length - 8));
  return (
    <Text color={PALETTE.border} dimColor={!active}>
      {'── '}
      <Text color={active ? PALETTE.accent : PALETTE.muted}>{label}</Text>
      {` ${rule}`}
    </Text>
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
  // One screen throughout. The cursor is either in the menu on top or in the fields below it; with nothing pre-filled
  // there is nothing to review, so it starts in the fields.
  const [editing, setEditing] = useState(!prefilled);
  const [focus, setFocus] = useState(0);
  const [active, setActive] = useState(0);
  const [beforeEdit, setBeforeEdit] = useState(initialValues);

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

  const choose = (choice: MenuChoice): void => {
    if (choice === 'continue') void submit();
    else if (choice === 'edit') {
      setNotice(null);
      setBeforeEdit(values);
      setActive(0);
      setEditing(true);
    } else onBack();
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
        if (!prefilled) onBack();
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
        <Text bold>Contentful Credentials</Text>
        <Text> </Text>
        <Text color={PALETTE.muted}>
          {prefilled
            ? 'Credentials pre-filled from the configuration settings.'
            : 'Enter the Contentful space you want to import into.'}
        </Text>
        <Text> </Text>
        <SectionLabel label="Actions" active={!editing} />
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
        <Box flexDirection="column" marginTop={1}>
          <SectionLabel label="Space" active={editing} />
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

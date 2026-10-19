import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { PALETTE } from '../../theme.js';
import { ControlHints } from '../../control-hints.js';

export interface FormField<K extends string> {
  key: K;
  label: string;
  /** A short note shown dimmed after the value, so the label column stays narrow. */
  hint?: string;
  /** Shows dots instead of the value, for secrets. */
  masked?: boolean;
}

/** A row after the fields that Enter runs instead of opening for editing, such as "Run test". */
export interface FormAction {
  label: string;
  /** What running it does, shown dimmed after the label. */
  description: string;
  /** Shown instead of the description while it runs. */
  runningText?: string;
  running?: boolean;
  /** The control hint for Enter while this row is focused. */
  hint: string;
  onRun: () => void;
}

export type FormNotice = { kind: 'success' | 'error'; text: string };

interface FieldFormProps<K extends string> {
  title: string;
  /** What this form is for, shown dimmed under the title. */
  subtitle?: string;
  fields: readonly FormField<K>[];
  values: Record<K, string>;
  onChange: (key: K, value: string) => void;
  onSave: () => void;
  /** Leaves without saving. */
  onQuit: () => void;
  /** Rows after the fields that are run, not edited. They share the cursor with the fields. */
  actions?: readonly FormAction[];
  notice?: FormNotice | null;
  /** Ignores keys while a load or save is in flight. */
  busy?: boolean;
  /** Shown after the rows and the notice, for read-only content that belongs to the same screen. */
  children?: React.ReactNode;
}

/** The widest label among a form's rows. The form pads every label to it, and read-only rows use it to line up with them. */
export function formLabelWidth(rows: readonly { label: string }[]): number {
  return Math.max(...rows.map((row) => row.label.length));
}

/**
 * A label and value for read-only content shown with a form. It is built the same way as the form's own rows (a pointer
 * slot, the label padded to the shared width, then the value), so its values start in the same column as the form's.
 */
export function FormReadOnlyRow({
  label,
  labelWidth,
  children,
}: {
  label: string;
  labelWidth: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Box gap={1}>
      <Text> </Text>
      <Box width={labelWidth} flexShrink={0}>
        <Text color={PALETTE.muted}>{label}</Text>
      </Box>
      {children}
    </Box>
  );
}

/**
 * The edit-in-place form the Configuration pages share. Fields are read-only until Enter opens one; Enter again closes it.
 * While one is open, keys type into it (so a "q" in a path is just a "q"), and Esc closes it and restores the old value.
 * Actions sit after the fields and take the same cursor: Enter runs one, and `c` does nothing on it.
 */
export function FieldForm<K extends string>({
  title,
  subtitle,
  fields,
  values,
  onChange,
  onSave,
  onQuit,
  actions = [],
  notice,
  busy = false,
  children,
}: FieldFormProps<K>): React.ReactElement {
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState(false);
  const [valueBeforeEdit, setValueBeforeEdit] = useState('');

  // The cursor walks the fields first, then the actions.
  const rowCount = fields.length + actions.length;
  const labelWidth = formLabelWidth([...fields, ...actions]);
  const currentField = active < fields.length ? fields[active] : undefined;
  const currentAction = currentField ? undefined : actions[active - fields.length];

  useInput((input, key) => {
    if (busy) return;

    if (editing) {
      // <TextInput> handles typing, the cursor, left/right and Enter (onSubmit) itself.
      if (key.escape && currentField) {
        onChange(currentField.key, valueBeforeEdit);
        setEditing(false);
      }
      return;
    }

    if (key.escape || input === 'q') {
      onQuit();
      return;
    }
    if (input === 's') {
      onSave();
      return;
    }
    if (input === 'c' && currentField) {
      onChange(currentField.key, '');
      return;
    }
    if (key.tab || key.downArrow) {
      setActive((i) => (i + 1) % rowCount);
      return;
    }
    if (key.upArrow) {
      setActive((i) => (i - 1 + rowCount) % rowCount);
      return;
    }
    if (key.return) {
      if (currentField) {
        setValueBeforeEdit(values[currentField.key]);
        setEditing(true);
      } else {
        currentAction?.onRun();
      }
    }
  });

  const pointer = (isActive: boolean): React.ReactElement => (
    <Text color={isActive ? PALETTE.accent : undefined}>{isActive ? '❯' : ' '}</Text>
  );

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>{title}</Text>
      {subtitle && <Text color={PALETTE.muted}>{subtitle}</Text>}
      <Text> </Text>
      <Box flexDirection="column">
        {fields.map((field, index) => {
          const isActive = index === active;
          const value = values[field.key];
          const display = field.masked ? '•'.repeat(value.length) : value;
          return (
            <Box key={field.key} gap={1}>
              {pointer(isActive)}
              <Box width={labelWidth} flexShrink={0}>
                <Text bold={isActive} color={isActive ? PALETTE.accent : PALETTE.muted}>
                  {field.label}
                </Text>
              </Box>
              {isActive && editing ? (
                <TextInput
                  value={value}
                  onChange={(next) => onChange(field.key, next)}
                  onSubmit={() => setEditing(false)}
                  mask={field.masked ? '•' : undefined}
                />
              ) : display ? (
                <Text bold>{display}</Text>
              ) : (
                // An empty value shows its hint (or "(empty)") in the value's place, not after an empty element, so the
                // text starts in the same column as every other row's.
                <Text color={PALETTE.muted}>{field.hint ?? '(empty)'}</Text>
              )}
              {display && field.hint && <Text color={PALETTE.muted}>{field.hint}</Text>}
            </Box>
          );
        })}
        {actions.map((action, index) => {
          const isActive = fields.length + index === active;
          return (
            <Box key={action.label} gap={1}>
              {pointer(isActive)}
              <Box width={labelWidth} flexShrink={0}>
                <Text bold={isActive} color={isActive ? PALETTE.accent : PALETTE.muted}>
                  {action.label}
                </Text>
              </Box>
              <Text color={action.running ? PALETTE.accent : PALETTE.muted}>
                {action.running ? (action.runningText ?? 'running...') : action.description}
              </Text>
            </Box>
          );
        })}
      </Box>
      {notice && (
        <>
          <Text> </Text>
          <Text color={notice.kind === 'success' ? PALETTE.success : PALETTE.error}>
            {notice.kind === 'success' ? '✓' : '✗'} {notice.text}
          </Text>
        </>
      )}
      {children}
      <Text> </Text>
      <ControlHints
        hints={
          editing
            ? [
                { keys: 'type', label: 'edit' },
                { keys: '←/→', label: 'move cursor' },
                { keys: '⏎', label: 'done' },
                { keys: 'Esc', label: 'cancel edit' },
              ]
            : [
                { keys: '↑/↓', label: 'move' },
                { keys: '⏎', label: currentAction ? currentAction.hint : 'edit' },
                ...(currentField ? [{ keys: 'c', label: 'clear' }] : []),
                { keys: 's', label: 'save' },
                { keys: 'Esc/q', label: 'back without saving' },
              ]
        }
      />
    </Box>
  );
}

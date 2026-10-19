import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { PALETTE } from '../../home/home.theme.js';
import { ControlHints } from '../../control-hints.js';

export interface FormField<K extends string> {
  key: K;
  label: string;
  /** A short note shown dimmed after the value, so the label column stays narrow. */
  hint?: string;
  /** Shows dots instead of the value, for secrets. */
  masked?: boolean;
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
  notice?: FormNotice | null;
  /** Ignores keys while a load or save is in flight. */
  busy?: boolean;
  /** Shown above the controls, for a screen's own explanation. */
  footer?: React.ReactNode;
  /** Extra single-key actions. They only fire when no field is open, so typing a "t" into a path is just a "t". */
  actions?: readonly { key: string; label: string; run: () => void }[];
}

/**
 * The edit-in-place form the Configuration pages share. Fields are read-only until Enter opens one; Enter again closes it.
 * While one is open, keys type into it (so a "q" in a path is just a "q"), and Esc closes it and restores the old value.
 */
export function FieldForm<K extends string>({
  title,
  subtitle,
  fields,
  values,
  onChange,
  onSave,
  onQuit,
  notice,
  busy = false,
  footer,
  actions = [],
}: FieldFormProps<K>): React.ReactElement {
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState(false);
  const [valueBeforeEdit, setValueBeforeEdit] = useState('');

  const labelWidth = Math.max(...fields.map((field) => field.label.length));
  const current = fields[active]!;

  useInput((input, key) => {
    if (busy) return;

    if (editing) {
      // <TextInput> handles typing, the cursor, left/right and Enter (onSubmit) itself.
      if (key.escape) {
        onChange(current.key, valueBeforeEdit);
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
    if (input === 'c') {
      onChange(current.key, '');
      return;
    }
    const action = actions.find((candidate) => candidate.key === input);
    if (action) {
      action.run();
      return;
    }
    if (key.tab || key.downArrow) {
      setActive((i) => (i + 1) % fields.length);
      return;
    }
    if (key.upArrow) {
      setActive((i) => (i - 1 + fields.length) % fields.length);
      return;
    }
    if (key.return) {
      setValueBeforeEdit(values[current.key]);
      setEditing(true);
    }
  });

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
              <Text color={isActive ? PALETTE.accent : undefined}>{isActive ? '❯' : ' '}</Text>
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
              ) : (
                <Text bold={!!display}>
                  {display || (field.hint ? '' : <Text color={PALETTE.muted}>(empty)</Text>)}
                </Text>
              )}
              {field.hint && <Text color={PALETTE.muted}>{field.hint}</Text>}
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
      {footer}
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
                { keys: '⏎', label: 'edit' },
                { keys: 'c', label: 'clear' },
                { keys: 's', label: 'save' },
                ...actions.map(({ key, label }) => ({ keys: key, label })),
                { keys: 'Esc/q', label: 'back without saving' },
              ]
        }
      />
    </Box>
  );
}

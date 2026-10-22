import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { ClearableTextInput } from './ClearableTextInput.js';
import { ControlHints } from './ControlHints.js';
import { StepHeader } from './StepHeader.js';

export interface SetupMenuItem<C extends string> {
  /** `edit` is reserved: choosing it turns the rows below into inputs. */
  choice: C;
  label: string;
  /** What choosing it does, shown dimmed after the label. */
  description: string;
}

export interface SetupField<K extends string> {
  key: K;
  label: string;
  /** Shows dots instead of the value, for secrets. */
  masked?: boolean;
  /** Shown dimmed in the value's place while it is empty. */
  hint?: string;
  /** What is known about the value, such as the result of checking it. Shown under the row. */
  note?: React.ReactNode;
}

interface SetupFormProps<K extends string, C extends string> {
  title: string;
  subtitle?: string;
  menu: readonly SetupMenuItem<C>[];
  /** The heading over the values, which sit under a divider and are not part of the menu. */
  dataTitle: string;
  fields: readonly SetupField<K>[];
  values: Record<K, string>;
  /** Called on every keystroke while a field is open. */
  onChange: (key: K, value: string) => void;
  /** Called when the last field is done, so the caller can check what was entered. */
  onCommit: () => void;
  /** Called when editing is cancelled with Esc, so the caller can put the earlier values back. */
  onCancel: () => void;
  onEditStart?: () => void;
  onChoose: (choice: Exclude<C, 'edit'>) => void;
  /** What Esc does from the menu. */
  onEscape: () => void;
  /** Opens with the fields already editable, for a step with nothing to review yet. */
  initialEditing?: boolean;
  /** Ignores keys while something is in flight. */
  busy?: boolean;
  /** Shown under the values, for read-only content that belongs to the same screen. */
  children?: React.ReactNode;
}

/**
 * The layout the setup steps share. A menu of actions sits on top and the values sit below a divider. `Edit` does not
 * change screens: the same rows become inputs where they are, the menu stays put (dimmed), and finishing the last field
 * puts the cursor back on the first menu item.
 */
export function SetupForm<K extends string, C extends string>({
  title,
  subtitle,
  menu,
  dataTitle,
  fields,
  values,
  onChange,
  onCommit,
  onCancel,
  onEditStart,
  onChoose,
  onEscape,
  initialEditing = false,
  busy = false,
  children,
}: SetupFormProps<K, C>): React.ReactElement {
  const [focus, setFocus] = useState(0);
  const [editing, setEditing] = useState(initialEditing);
  const [active, setActive] = useState(0);

  const menuFocus = Math.min(focus, menu.length - 1);
  const isLastField = active === fields.length - 1;

  const startEditing = (): void => {
    onEditStart?.();
    setActive(0);
    setEditing(true);
  };

  const finishEditing = (): void => {
    setEditing(false);
    setFocus(0);
    onCommit();
  };

  useInput((_input, key) => {
    if (busy) return;
    if (editing) {
      if (key.escape) {
        setEditing(false);
        setFocus(0);
        onCancel();
      } else if (key.upArrow) setActive((current) => (current - 1 + fields.length) % fields.length);
      else if (key.downArrow || key.tab) setActive((current) => (current + 1) % fields.length);
      return;
    }
    if (key.escape) onEscape();
    else if (key.return) {
      const choice = menu[menuFocus]!.choice;
      if (choice === 'edit') startEditing();
      else onChoose(choice as Exclude<C, 'edit'>);
    } else if (key.upArrow) setFocus((current) => (current - 1 + menu.length) % menu.length);
    else if (key.downArrow || key.tab) setFocus((current) => (current + 1) % menu.length);
  });

  const menuWidth = Math.max(...menu.map((item) => item.label.length));
  const labelWidth = Math.max(...fields.map((field) => field.label.length));

  return (
    <Box flexDirection="column">
      <StepHeader step="setup" />
      <Box flexDirection="column" paddingX={2} paddingBottom={1}>
        <Text bold color={PALETTE.text}>
          {title}
        </Text>
        <Text> </Text>
        {subtitle && (
          <>
            <Text color={PALETTE.muted}>{subtitle}</Text>
            <Text> </Text>
          </>
        )}
        <Text bold color={editing ? PALETTE.muted : PALETTE.accent}>
          {editing ? 'EDITING' : 'ACTIONS'}
        </Text>
        {menu.map((item, index) => {
          const focused = !editing && index === menuFocus;
          return (
            <Box key={item.choice} gap={1}>
              <Text bold color={PALETTE.accent}>
                {focused ? '❯' : ' '}
              </Text>
              <Box width={menuWidth} flexShrink={0}>
                <Text bold={focused} color={editing ? PALETTE.muted : focused ? PALETTE.accent : PALETTE.text}>
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
          <Text bold color={editing ? PALETTE.accent : PALETTE.muted}>
            {dataTitle.toUpperCase()}
          </Text>
          {fields.map((field, index) => {
            const open = editing && index === active;
            const value = values[field.key];
            const display = field.masked ? '•'.repeat(value.length) : value;
            return (
              <Box key={field.key} flexDirection="column">
                <Box gap={1}>
                  <Text bold color={PALETTE.accent}>
                    {open ? '❯' : ' '}
                  </Text>
                  <Box width={labelWidth} flexShrink={0}>
                    <Text bold={open} color={open ? PALETTE.accent : PALETTE.muted}>
                      {field.label}
                    </Text>
                  </Box>
                  {open ? (
                    <ClearableTextInput
                      value={value}
                      onChange={(next) => onChange(field.key, next)}
                      onSubmit={isLastField ? finishEditing : () => setActive(active + 1)}
                      mask={field.masked ? '•' : undefined}
                    />
                  ) : display ? (
                    <Text color={PALETTE.text}>{display}</Text>
                  ) : (
                    <Text color={PALETTE.muted}>{field.hint ?? '(empty)'}</Text>
                  )}
                </Box>
                {field.note && <Box paddingLeft={labelWidth + 3}>{field.note}</Box>}
              </Box>
            );
          })}
          {children}
        </Box>
        {editing && (
          <>
            <Text> </Text>
            <ControlHints
              hints={[
                { keys: '↑/↓', label: 'field' },
                { keys: '⏎', label: isLastField ? 'done' : 'next field' },
                { keys: 'Ctrl+D', label: 'clear' },
                { keys: 'Esc', label: 'cancel' },
              ]}
            />
          </>
        )}
      </Box>
    </Box>
  );
}

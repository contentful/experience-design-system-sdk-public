import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { FormReadOnlyRow, formLabelWidth } from './FieldForm.js';
import { StepHeader } from './StepHeader.js';

export interface MenuItem<C extends string> {
  choice: C;
  label: string;
  /** What choosing it does, shown dimmed after the label. */
  description: string;
}

interface MenuRow {
  label: string;
  /** Shown bold; an empty value shows "(empty)". */
  value: string;
}

interface MenuScreenProps<C extends string> {
  title: string;
  subtitle?: string;
  menu: readonly MenuItem<C>[];
  /** Read-only values shown under the menu, lined up with it. */
  rows?: readonly MenuRow[];
  onChoose: (choice: C) => void;
  /** What Esc does. */
  onEscape: () => void;
  /** The heading over the read-only part, which sits under a divider and is never focusable. */
  dataTitle?: string;
  /** Ignores keys while something is in flight. */
  busy?: boolean;
  /** Shown after the rows, for read-only content that belongs to the same screen. */
  children?: React.ReactNode;
}

/**
 * The layout the setup steps share: a title, a menu of actions on top, the read-only data below it and the key hints.
 * Values are never edited here; an `Edit` item opens the step's own input instead.
 */
export function MenuScreen<C extends string>({
  title,
  subtitle,
  menu,
  rows = [],
  onChoose,
  onEscape,
  dataTitle = 'Details',
  busy = false,
  children,
}: MenuScreenProps<C>): React.ReactElement {
  const [focus, setFocus] = useState(0);

  useInput((_input, key) => {
    if (busy) return;
    if (key.escape) onEscape();
    else if (key.return) onChoose(menu[focus]!.choice);
    else if (key.upArrow) setFocus((current) => (current - 1 + menu.length) % menu.length);
    else if (key.downArrow || key.tab) setFocus((current) => (current + 1) % menu.length);
  });

  const labelWidth = formLabelWidth([...menu, ...rows]);

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
        <Text bold color={PALETTE.accent}>
          ACTIONS
        </Text>
        {menu.map((item, index) => {
          const focused = index === focus;
          return (
            <Box key={item.choice} gap={1}>
              <Text bold color={PALETTE.accent}>
                {focused ? '❯' : ' '}
              </Text>
              <Box width={labelWidth} flexShrink={0}>
                <Text bold={focused} color={focused ? PALETTE.accent : PALETTE.text}>
                  {item.label}
                </Text>
              </Box>
              <Text color={PALETTE.muted}>{item.description}</Text>
            </Box>
          );
        })}
        {(rows.length > 0 || children) && (
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
              {dataTitle.toUpperCase()}
            </Text>
            {rows.map((row) => (
              <FormReadOnlyRow key={row.label} label={row.label} labelWidth={labelWidth}>
                <Text color={row.value ? PALETTE.text : PALETTE.muted}>{row.value || '(empty)'}</Text>
              </FormReadOnlyRow>
            ))}
            {children}
          </Box>
        )}
      </Box>
    </Box>
  );
}

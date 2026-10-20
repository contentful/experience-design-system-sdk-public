import React, { useRef } from 'react';
import { useInput } from 'ink';
import TextInput from 'ink-text-input';

// The one "clear this field" key for every text input. A plain letter can't be used because the field
// would type it, so it is Ctrl+D.
export const CLEAR_CONTROL = { keys: 'Ctrl+D', label: 'Clear' } as const;

export function isClearKey(input: string, key: { ctrl: boolean }): boolean {
  return key.ctrl && input === 'd';
}

type ClearableTextInputProps = React.ComponentProps<typeof TextInput>;

// A TextInput that clears on Ctrl+D. ink-text-input only ignores Ctrl+C, so it also types a "d" for this
// key; that stray change is dropped, whichever of the two handlers runs first.
export function ClearableTextInput({ onChange, ...props }: ClearableTextInputProps): React.ReactElement {
  const justCleared = useRef(false);

  useInput((input, key) => {
    if (!isClearKey(input, key)) return;
    justCleared.current = true;
    setTimeout(() => {
      justCleared.current = false;
    }, 0);
    onChange('');
  });

  return (
    <TextInput
      {...props}
      onChange={(value) => {
        if (!justCleared.current) onChange(value);
      }}
    />
  );
}

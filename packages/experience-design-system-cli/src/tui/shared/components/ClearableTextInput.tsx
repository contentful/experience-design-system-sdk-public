import React, { useRef } from 'react';
import { useInput } from 'ink';
import TextInput from 'ink-text-input';

export function isClearKey(input: string, key: { ctrl: boolean }): boolean {
  return key.ctrl && input === 'd';
}

// ink-text-input also types a "d" for Ctrl+D, so that change is dropped.
export function ClearableTextInput({ onChange, ...props }: React.ComponentProps<typeof TextInput>): React.ReactElement {
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

import React, { useState } from 'react';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClearableTextInput } from '../../src/tui/shared/components/ClearableTextInput.js';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

function Field({ onValue }: { onValue: (value: string) => void }): React.ReactElement {
  const [value, setValue] = useState('');
  return (
    <ClearableTextInput
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
      onSubmit={vi.fn()}
    />
  );
}

afterEach(cleanup);

describe('ClearableTextInput', () => {
  it('keeps typed text as typed', async () => {
    const onValue = vi.fn();
    const { stdin } = render(<Field onValue={onValue} />);
    await tick();

    stdin.write('/Users/me/My Library');
    await tick();

    expect(onValue).toHaveBeenLastCalledWith('/Users/me/My Library');
  });

  it('drops control characters pasted with a value', async () => {
    const onValue = vi.fn();
    const { stdin, lastFrame } = render(<Field onValue={onValue} />);
    await tick();

    stdin.write('/Users/me/src/components\r\n');
    await tick();

    expect(onValue).toHaveBeenLastCalledWith('/Users/me/src/components');
    expect(lastFrame()).not.toContain('\r');
  });
});

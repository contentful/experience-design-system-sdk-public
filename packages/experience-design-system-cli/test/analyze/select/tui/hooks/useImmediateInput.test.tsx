import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { useImmediateInput } from '../../../../../src/analyze/select/tui/hooks/useImmediateInput.js';

type KeyLike = {
  tab?: boolean;
  shiftTab?: boolean;
  return?: boolean;
  escape?: boolean;
};

function Harness(props: { onKey: (input: string, key: KeyLike) => void }): React.ReactElement {
  useImmediateInput((input, key) => {
    props.onKey(input, key);
  });
  return <Text>ready</Text>;
}

describe('useImmediateInput — Shift-Tab detection', () => {
  it('surfaces key.shiftTab (and key.tab) on CSI Z (\\x1b[Z)', () => {
    const events: Array<{ input: string; key: KeyLike }> = [];
    const { stdin, unmount, lastFrame } = render(<Harness onKey={(input, key) => events.push({ input, key })} />);
    // Ensure the layout effect has attached the stdin listener before writing.
    lastFrame();
    stdin.write('\x1b[Z');
    unmount();
    const shiftTabHit = events.find((e) => e.key.shiftTab === true);
    expect(shiftTabHit).toBeDefined();
    // Same event fires key.tab so existing tab handlers still see it.
    expect(shiftTabHit!.key.tab).toBe(true);
  });

  it('plain Tab does not fire key.shiftTab', () => {
    const events: Array<{ input: string; key: KeyLike }> = [];
    const { stdin, unmount, lastFrame } = render(<Harness onKey={(input, key) => events.push({ input, key })} />);
    // Ensure the layout effect has attached the stdin listener before writing.
    lastFrame();
    stdin.write('\t');
    unmount();
    const tabHit = events.find((e) => e.key.tab === true);
    expect(tabHit).toBeDefined();
    expect(tabHit!.key.shiftTab).toBe(false);
  });
});

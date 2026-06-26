import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { TokenInputStep } from '../../../../src/import/tui/steps/TokenInputStep.js';

// Round-3 Feature 1: typing-mode escape.
//
// The pre-fix component matched `input === 's'` BEFORE the char-append
// fallthrough, so any tokens path containing `s` (e.g. `~/styles/tokens.json`)
// was aborted on the first `s` keystroke. These tests pin the new typing-mode
// behavior:
//   - while typing, `s` / `q` append to the buffer.
//   - `Tab` exits typing mode and preserves the buffer.
//   - `Esc` exits typing mode and clears the buffer.
//   - with empty buffer (ambient), `s` skips, `q` quits, Enter skips.
//   - backspace-to-empty stays in typing mode (does NOT re-arm `s` as skip).

function lastFrameContains(frame: string | undefined, fragment: string): boolean {
  return Boolean(frame && frame.includes(fragment));
}

describe('TokenInputStep — typing-mode escape', () => {
  it('preserves a path containing `s` (regression: ~/styles/tokens.json)', () => {
    const onSkip = vi.fn();
    const onConfirm = vi.fn();
    const onQuit = vi.fn();
    const { stdin, lastFrame } = render(
      <TokenInputStep onConfirm={onConfirm} onSkip={onSkip} onQuit={onQuit} />,
    );
    const path = '~/styles/tokens.json';
    for (const ch of path) stdin.write(ch);
    expect(onSkip).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onQuit).not.toHaveBeenCalled();
    expect(lastFrameContains(lastFrame(), path)).toBe(true);
  });

  it('`s` as first keystroke triggers skip (ambient mode)', () => {
    const onSkip = vi.fn();
    const { stdin } = render(
      <TokenInputStep onConfirm={() => {}} onSkip={onSkip} onQuit={() => {}} />,
    );
    stdin.write('s');
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('`q` as first keystroke triggers quit (ambient mode)', () => {
    const onQuit = vi.fn();
    const { stdin } = render(
      <TokenInputStep onConfirm={() => {}} onSkip={() => {}} onQuit={onQuit} />,
    );
    stdin.write('q');
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('Tab exits typing mode without clearing the buffer', () => {
    const onSkip = vi.fn();
    const { stdin, lastFrame } = render(
      <TokenInputStep onConfirm={() => {}} onSkip={onSkip} onQuit={() => {}} />,
    );
    stdin.write('a');
    stdin.write('b');
    stdin.write('c');
    stdin.write('\t');
    stdin.write('s');
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(lastFrameContains(lastFrame(), 'abc')).toBe(true);
  });

  it('Esc exits typing mode AND clears the buffer', () => {
    const onSkip = vi.fn();
    const onQuit = vi.fn();
    const { stdin, lastFrame } = render(
      <TokenInputStep onConfirm={() => {}} onSkip={onSkip} onQuit={onQuit} />,
    );
    stdin.write('a');
    stdin.write('b');
    stdin.write('c');
    stdin.write('\x1b');
    // Buffer should be empty now — should NOT contain 'abc'.
    expect(lastFrameContains(lastFrame(), 'abc')).toBe(false);
    // onQuit must NOT have fired (Esc in typing mode = clear-exit, not quit).
    expect(onQuit).not.toHaveBeenCalled();
    stdin.write('s');
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('Enter on empty buffer fires onSkip (existing behavior pinned)', () => {
    const onSkip = vi.fn();
    const { stdin } = render(
      <TokenInputStep onConfirm={() => {}} onSkip={onSkip} onQuit={() => {}} />,
    );
    stdin.write('\r');
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('Backspace-to-empty stays in typing mode (does NOT re-arm `s` as skip)', () => {
    const onSkip = vi.fn();
    const { stdin, lastFrame } = render(
      <TokenInputStep onConfirm={() => {}} onSkip={onSkip} onQuit={() => {}} />,
    );
    stdin.write('a');
    stdin.write('\x7f'); // backspace
    stdin.write('s');
    expect(onSkip).not.toHaveBeenCalled();
    expect(lastFrameContains(lastFrame(), 's')).toBe(true);
  });
});

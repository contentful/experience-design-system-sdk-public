import { describe, expect, it, vi } from 'vitest';
import { getInteractiveTerminalSupport, requireInteractiveTerminal } from '../../src/lib/terminal-capabilities.js';

describe('terminal capabilities', () => {
  it('accepts a TTY whose input can enter and leave raw mode', () => {
    const setRawMode = vi.fn();

    expect(
      getInteractiveTerminalSupport({
        stdin: { isTTY: true, isRaw: false, setRawMode },
        stdout: { isTTY: true },
      }),
    ).toEqual({ supported: true });
    expect(setRawMode.mock.calls).toEqual([[true], [false]]);
  });

  it('does not disturb input that is already in raw mode', () => {
    const setRawMode = vi.fn();

    expect(
      getInteractiveTerminalSupport({
        stdin: { isTTY: true, isRaw: true, setRawMode },
        stdout: { isTTY: true },
      }),
    ).toEqual({ supported: true });
    expect(setRawMode).toHaveBeenCalledOnce();
    expect(setRawMode).toHaveBeenCalledWith(true);
  });

  it.each([
    [{ isTTY: false, setRawMode: vi.fn() }, { isTTY: true }, 'input-not-tty'],
    [{ isTTY: true, setRawMode: vi.fn() }, { isTTY: false }, 'output-not-tty'],
    [{ isTTY: true }, { isTTY: true }, 'raw-mode-unavailable'],
  ] as const)('rejects missing terminal capability', (stdin, stdout, reason) => {
    expect(getInteractiveTerminalSupport({ stdin, stdout })).toEqual({ supported: false, reason });
  });

  it('turns a raw-mode probe failure into an actionable result and attempts cleanup', () => {
    const setRawMode = vi.fn((enabled: boolean) => {
      if (enabled) throw new Error('unsupported console mode');
    });

    expect(
      getInteractiveTerminalSupport({
        stdin: { isTTY: true, isRaw: false, setRawMode },
        stdout: { isTTY: true },
      }),
    ).toEqual({ supported: false, reason: 'raw-mode-unavailable' });
    expect(setRawMode.mock.calls).toEqual([[true], [false]]);
  });

  it('provides a Windows terminal and command-specific noninteractive alternative', () => {
    expect(() =>
      requireInteractiveTerminal({
        stdin: {
          isTTY: true,
          setRawMode: () => {
            throw new Error('unsupported console mode');
          },
        },
        stdout: { isTTY: true },
        alternative: 'pass `--select-all`',
      }),
    ).toThrowError(
      'Interactive terminal UI is unavailable because standard input cannot enter raw mode.\n' +
        'On Windows, run this command in Windows Terminal with PowerShell.\n' +
        'To continue without the UI, pass `--select-all`.',
    );
  });
});

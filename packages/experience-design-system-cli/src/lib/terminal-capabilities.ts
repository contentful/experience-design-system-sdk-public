export type TerminalInput = {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (enabled: boolean) => unknown;
};

export type TerminalOutput = {
  isTTY?: boolean;
};

export type InteractiveTerminalSupport =
  | { supported: true }
  | {
      supported: false;
      reason: 'input-not-tty' | 'output-not-tty' | 'raw-mode-unavailable';
    };

export type TerminalCapabilityOptions = {
  stdin?: TerminalInput;
  stdout?: TerminalOutput;
};

/**
 * Check the capabilities Ink's interactive input hooks require before the UI
 * mounts. A stream can report itself as a TTY while its terminal host still
 * rejects raw mode, so the check briefly enables and restores raw mode.
 */
export function getInteractiveTerminalSupport(options: TerminalCapabilityOptions = {}): InteractiveTerminalSupport {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;

  if (stdout.isTTY !== true) return { supported: false, reason: 'output-not-tty' };
  if (stdin.isTTY !== true) return { supported: false, reason: 'input-not-tty' };
  if (typeof stdin.setRawMode !== 'function') {
    return { supported: false, reason: 'raw-mode-unavailable' };
  }

  const wasRaw = stdin.isRaw === true;
  try {
    stdin.setRawMode(true);
    if (!wasRaw) stdin.setRawMode(false);
  } catch {
    if (!wasRaw) {
      try {
        stdin.setRawMode(false);
      } catch {
        // The original capability failure is the actionable result.
      }
    }
    return { supported: false, reason: 'raw-mode-unavailable' };
  }

  return { supported: true };
}

export type RequireInteractiveTerminalOptions = TerminalCapabilityOptions & {
  alternative?: string;
};

export function requireInteractiveTerminal(options: RequireInteractiveTerminalOptions = {}): void {
  const support = getInteractiveTerminalSupport(options);
  if (support.supported) return;

  const reason =
    support.reason === 'output-not-tty'
      ? 'standard output is not a TTY'
      : support.reason === 'input-not-tty'
        ? 'standard input is not a TTY'
        : 'standard input cannot enter raw mode';
  const lines = [
    `Interactive terminal UI is unavailable because ${reason}.`,
    'On Windows, run this command in Windows Terminal with PowerShell.',
  ];
  if (options.alternative) lines.push(`To continue without the UI, ${options.alternative}.`);
  throw new Error(lines.join('\n'));
}

interface TerminalHandle {
  reading?: boolean;
  readStart?: () => unknown;
  readStop?: () => unknown;
}

function getTerminalHandle(): TerminalHandle | undefined {
  return (process.stdin as unknown as { _handle?: TerminalHandle })._handle;
}

export async function stopReadingTerminal(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));

  const handle = getTerminalHandle();
  if (!handle?.readStop) return;
  handle.reading = false;
  handle.readStop();
}

export function startReadingTerminal(): void {
  const handle = getTerminalHandle();
  if (!handle?.readStart) return;
  handle.reading = true;
  handle.readStart();
}

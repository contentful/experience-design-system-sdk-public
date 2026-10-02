import { render } from 'ink-testing-library';
import { Text } from 'ink';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

const terminal = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    columns: 80,
    rows: 24,
    on: (_event: string, listener: () => void) => listeners.add(listener),
    off: (_event: string, listener: () => void) => listeners.delete(listener),
    emit: (_event: string) => listeners.forEach((listener) => listener()),
  };
});

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink');
  return {
    ...actual,
    useStdout: () => ({ stdout: terminal }),
  };
});

import { useTerminalSize } from '../../src/tui/use-terminal-size.js';

function SizeProbe(): React.ReactElement {
  const { columns, rows } = useTerminalSize();
  return (
    <Text>
      {columns}x{rows}
    </Text>
  );
}

describe('useTerminalSize', () => {
  it('rerenders all consumers when stdout emits resize', async () => {
    const { lastFrame } = render(<SizeProbe />);
    expect(lastFrame()).toContain('80x24');

    terminal.columns = 120;
    terminal.rows = 40;
    terminal.emit('resize');

    await vi.waitFor(() => expect(lastFrame()).toContain('120x40'));
  });
});

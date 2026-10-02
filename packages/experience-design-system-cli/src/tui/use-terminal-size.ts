import { useStdout } from 'ink';
import { useEffect, useState } from 'react';

export type TerminalSize = {
  columns: number;
  rows: number;
};

function readTerminalSize(stdout: NodeJS.WriteStream | undefined): TerminalSize {
  return {
    columns: stdout?.columns ?? 80,
    rows: stdout?.rows ?? process.stdout.rows ?? 40,
  };
}

/** Keep layout consumers synchronized with terminal resize events. */
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const [size, setSize] = useState<TerminalSize>(() => readTerminalSize(stdout));

  useEffect(() => {
    const updateSize = (): void => setSize(readTerminalSize(stdout));
    stdout?.on('resize', updateSize);
    updateSize();

    return () => {
      stdout?.off('resize', updateSize);
    };
  }, [stdout]);

  return size;
}

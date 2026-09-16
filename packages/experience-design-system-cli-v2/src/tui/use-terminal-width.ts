import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

const FALLBACK_COLUMNS = 80;

function readColumns(stdout: NodeJS.WriteStream | undefined): number {
  const columns = stdout?.columns ?? 0;
  return columns > 0 ? columns : FALLBACK_COLUMNS;
}

export function useTerminalWidth(): number {
  const { stdout } = useStdout();
  const [columns, setColumns] = useState(() => readColumns(stdout));

  useEffect(() => {
    if (!stdout) return;

    const onResize = (): void => setColumns(readColumns(stdout));
    onResize();
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return columns;
}

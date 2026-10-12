import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

const FALLBACK_ROWS = 24;

function readRows(stdout: NodeJS.WriteStream | undefined): number {
  const rows = stdout?.rows ?? 0;
  return rows > 0 ? rows : FALLBACK_ROWS;
}

export function useTerminalRows(): number {
  const { stdout } = useStdout();
  const [rows, setRows] = useState(() => readRows(stdout));

  useEffect(() => {
    if (!stdout) return;

    const onResize = (): void => setRows(readRows(stdout));
    onResize();
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return rows;
}

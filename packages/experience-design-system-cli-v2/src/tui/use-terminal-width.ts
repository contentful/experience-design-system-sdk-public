import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

/** Assumed width when stdout reports none, e.g. when output is piped. */
const FALLBACK_COLUMNS = 80;

/**
 * Width stdout reports, falling back when it is missing or non-positive.
 *
 * A pseudo-terminal can report `0` rather than `undefined` before its size is
 * known, so a nullish check alone would let a zero through and collapse any
 * layout derived from it.
 */
function readColumns(stdout: NodeJS.WriteStream | undefined): number {
  const columns = stdout?.columns ?? 0;
  return columns > 0 ? columns : FALLBACK_COLUMNS;
}

/**
 * Current terminal width in columns, updated on resize.
 *
 * `useStdout` alone exposes `columns` but does not re-render when the window
 * changes, so this subscribes to the stream's own resize event.
 */
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

import { useLayoutEffect } from 'react';
import { useStdin } from 'ink';

/**
 * Enables raw terminal mode for the lifetime of the component.
 * Call once at the root of each top-level TUI component.
 * useImmediateInput does NOT manage raw mode — this hook does.
 */
export function useRawMode(): void {
  const { setRawMode } = useStdin();

  useLayoutEffect(() => {
    setRawMode(true);
    return () => {
      setRawMode(false);
    };
  }, [setRawMode]);
}

import { useStdout } from 'ink';

export function useTerminalColumns(): number {
  const { stdout } = useStdout();
  return stdout?.columns ?? 80;
}

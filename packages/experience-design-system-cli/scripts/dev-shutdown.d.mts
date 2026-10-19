export interface StoppableChild {
  readonly closed: boolean;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal: 'SIGTERM'): boolean;
}

export function stopChildAndWait(child: StoppableChild | null | undefined): Promise<void | number | null>;

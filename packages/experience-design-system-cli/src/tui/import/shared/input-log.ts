// The lines the steps that ask for a path or credentials share in a debug log.

export type PathSource = 'prefilled' | 'typed';

/**
 * Whether the path the user continued with is the one the import started with, or null when they left without one.
 * `entered` is what they typed to get there, before it was resolved.
 */
export function pathSourceOf(continuedWith: string | null, entered: string, initialPath: string): PathSource | null {
  if (continuedWith === null) return null;
  return initialPath.trim() !== '' && entered === initialPath.trim() ? 'prefilled' : 'typed';
}

export const pathSourceLine = (source: PathSource | null): string[] =>
  source ? [`Path source: ${source === 'prefilled' ? 'pre-filled, kept as is' : 'typed by the user'}`] : [];

export const wentBackLine = (endedOnError: string | undefined): string[] =>
  endedOnError ? [`Went back while this error was showing: ${endedOnError}`] : [];

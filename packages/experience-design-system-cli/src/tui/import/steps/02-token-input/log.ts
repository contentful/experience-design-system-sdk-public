import { importModeLabel, type ImportTarget } from '../00-preflight/logic.js';

// What the debug log says about the Token input: the file the user ended up with, and above all why a path was turned
// down, so "I could not get past this step" can be read from the log. Nothing typed but not submitted is logged.

/** A path that was turned down, as typed, with the reason the user was shown. */
export type RejectedAttempt = { entered: string; error: string; resolved_path?: string };

/** The log's two sections: `summary` for a person, `data` for AI, both carrying the same facts. */
export function tokenInputLog({
  mode,
  tokenPath,
  enteredPath,
  initialPath,
  rejected,
  emptySubmits,
  endedOnError,
}: {
  mode: ImportTarget;
  /** The token file the user continued with, or null when they went back. */
  tokenPath: string | null;
  /** What they typed to get there, before it was resolved. */
  enteredPath: string;
  initialPath: string;
  rejected: readonly RejectedAttempt[];
  /** How many times Enter was pressed on an empty field. Counted apart from the rejected paths. */
  emptySubmits: number;
  /** The error still showing when the user went back, if there was one. */
  endedOnError: string | undefined;
}): { summary: string[]; data: Record<string, unknown> } {
  const kept = tokenPath !== null && initialPath.trim() !== '' && enteredPath === initialPath.trim();
  const source = tokenPath === null ? null : kept ? 'prefilled' : 'typed';

  const summary = [
    `Import mode: ${importModeLabel(mode)}`,
    tokenPath === null ? 'Token file: none (went back)' : `Token file: ${tokenPath}`,
    ...(source ? [`Path source: ${source === 'prefilled' ? 'pre-filled, kept as is' : 'typed by the user'}`] : []),
    `Rejected paths: ${rejected.length}`,
    ...rejected.map((attempt) => `  "${attempt.entered}" → ${attempt.error}`),
    `Empty submits: ${emptySubmits}`,
    ...(endedOnError ? [`Went back while this error was showing: ${endedOnError}`] : []),
  ];

  return {
    summary,
    data: {
      import_mode: mode,
      token_path: tokenPath,
      path_source: source,
      rejected_attempts: rejected,
      empty_submits: emptySubmits,
      ...(endedOnError ? { error: endedOnError } : {}),
    },
  };
}

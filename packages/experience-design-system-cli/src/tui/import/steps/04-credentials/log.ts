import { diffSnapshots, scrubError } from '@tui/shared/debug-trail.js';
import type { ImportTarget } from '../00-preflight/logic.js';
import type { CredentialField, CredentialValues } from './logic.js';

// What the debug log says about the Credentials. This is the one step that handles a secret, so everything here is about
// keeping the CMA token out of the file. The Data section is cleaned by the logger, which reduces the `cma_token` key to
// "present, N chars". The Summary lines are written as they are given, so the token line is built from the length alone
// and the value is never read.

export type CredentialAttempt = { host: string; reason: string };

/**
 * One rejected attempt as the log records it. The reason is scrubbed of the token first: an API error can echo what it
 * was sent, so the message the user saw may contain it.
 */
export function rejectedAttempt(reason: string, credentials: CredentialValues): CredentialAttempt {
  return { host: credentials.host, reason: scrubError(reason, [credentials.cmaToken]) };
}

const FIELD_LABELS: Record<CredentialField, string> = {
  spaceId: 'Space ID',
  environmentId: 'Environment ID',
  cmaToken: 'CMA token',
  host: 'API host',
};

/**
 * The log's two sections: `summary` for a person, `data` for AI, both carrying the same facts. `cma_token` is the only
 * key the token may be under in `data`.
 */
export function credentialsLog({
  mode,
  prefilled,
  credentials,
  initial,
  attempts,
  outcome,
  endedOnError,
}: {
  mode: ImportTarget;
  /** Whether the credentials came in already filled from the Settings. */
  prefilled: boolean;
  credentials: CredentialValues;
  initial: CredentialValues;
  attempts: readonly CredentialAttempt[];
  outcome: 'validated' | 'back';
  /** The (already scrubbed) reason still showing when the user went back, if there was one. */
  endedOnError: string | undefined;
}): { summary: string[]; data: Record<string, unknown> } {
  const changed = diffSnapshots(initial, credentials).changed_fields as CredentialField[];
  const tokenLength = credentials.cmaToken.length;

  const summary = [
    `Credentials: ${prefilled ? 'pre-filled from Settings' : 'entered by hand'}`,
    `Space ID: ${credentials.spaceId || 'not set'}`,
    `Environment: ${credentials.environmentId || 'not set'}`,
    `API host: ${credentials.host}`,
    `CMA token: ${tokenLength > 0 ? `present (${tokenLength} characters)` : 'not set'}`,
    `Changed by the user: ${changed.length > 0 ? changed.map((field) => FIELD_LABELS[field]).join(', ') : 'nothing'}`,
    `Rejected attempts: ${attempts.length}`,
    ...attempts.map((attempt) => `  ${attempt.reason}`),
    `Outcome: ${outcome === 'validated' ? 'validated' : 'went back'}`,
    ...(endedOnError ? [`Went back while this error was showing: ${endedOnError}`] : []),
  ];

  return {
    summary,
    data: {
      import_mode: mode,
      prefilled,
      space_id: credentials.spaceId,
      environment_id: credentials.environmentId,
      host: credentials.host,
      cma_token: credentials.cmaToken,
      changed_fields: changed,
      rejected_attempts: attempts,
      outcome,
      ...(endedOnError ? { error: endedOnError } : {}),
    },
  };
}

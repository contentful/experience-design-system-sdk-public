import { DEFAULT_CONFIGURED_HOST, toConfiguredHost } from '@contentful/experience-design-system-backend-pipeline';
import { diffSnapshots, scrubError } from '@tui/shared/debug-trail.js';

const FIELDS = ['spaceId', 'environmentId', 'cmaToken', 'host'] as const;

export type CredentialField = (typeof FIELDS)[number];

export type CredentialValues = Record<CredentialField, string>;

/**
 * Why the space is asked for. Components are looked up in it before they are generated, so that is part of the reason
 * unless the import only generates tokens, which has nothing to look up.
 */
export function credentialsPurpose(tokensOnly: boolean): string {
  const use = tokensOnly
    ? 'We use it to push your design tokens'
    : 'We use it to check what components already exist and to push your import';
  return `${use}.`;
}

export function normalize(values: CredentialValues): CredentialValues {
  return {
    spaceId: values.spaceId.trim(),
    environmentId: values.environmentId.trim(),
    cmaToken: values.cmaToken.trim(),
    host: toConfiguredHost(values.host) ?? DEFAULT_CONFIGURED_HOST,
  };
}

/** The required fields that are still empty, by name. */
export function missingFields(values: CredentialValues): CredentialField[] {
  return (['spaceId', 'environmentId', 'cmaToken'] as const).filter((field) => values[field] === '');
}

export function isUnchanged(current: CredentialValues, initial: CredentialValues): boolean {
  return FIELDS.every((field) => current[field] === initial[field]);
}

// What the debug log records. This is the one step that handles a secret, so everything here is about keeping the CMA
// token out of the file.

export type CredentialAttempt = { host: string; reason: string };

/**
 * One rejected attempt as the log records it. The reason is scrubbed of the token first: an API error can echo what it
 * was sent, so the message the user saw may contain it.
 */
export function rejectedAttempt(reason: string, credentials: CredentialValues): CredentialAttempt {
  return { host: credentials.host, reason: scrubError(reason, [credentials.cmaToken]) };
}

/**
 * The credentials as the log shows them. `cma_token` is the only key the token may be under: the logger reduces it to
 * "present, N chars", which is enough to spot a truncated paste without writing the secret.
 */
export function credentialsLog(credentials: CredentialValues): Record<string, unknown> {
  return {
    space_id: credentials.spaceId,
    environment_id: credentials.environmentId,
    host: credentials.host,
    cma_token: credentials.cmaToken,
  };
}

/** The log's outputs: where the user ended up, the credentials, which fields they changed (names only), and the rejections. */
export function credentialsOutputs({
  outcome,
  credentials,
  initial,
  attempts,
}: {
  outcome: 'validated' | 'back';
  credentials: CredentialValues;
  initial: CredentialValues;
  attempts: readonly CredentialAttempt[];
}): Record<string, unknown> {
  return {
    outcome,
    ...credentialsLog(credentials),
    changed_fields: diffSnapshots(initial, credentials).changed_fields,
    rejected_attempts: attempts,
  };
}

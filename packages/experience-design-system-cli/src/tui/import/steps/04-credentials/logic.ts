import { DEFAULT_CONFIGURED_HOST, toConfiguredHost } from '@contentful/experience-design-system-backend-pipeline';

const FIELDS = ['spaceId', 'environmentId', 'cmaToken', 'host'] as const;

export type CredentialField = (typeof FIELDS)[number];

export type CredentialValues = Record<CredentialField, string>;

export function normalize(values: CredentialValues): CredentialValues {
  return {
    spaceId: values.spaceId.trim(),
    environmentId: values.environmentId.trim(),
    cmaToken: values.cmaToken.trim(),
    host: toConfiguredHost(values.host) ?? DEFAULT_CONFIGURED_HOST,
  };
}

export function missingField(values: CredentialValues): boolean {
  return values.spaceId === '' || values.environmentId === '' || values.cmaToken === '';
}

export function isUnchanged(current: CredentialValues, initial: CredentialValues): boolean {
  return FIELDS.every((field) => current[field] === initial[field]);
}

import { DEFAULT_CONFIGURED_HOST, toConfiguredHost } from '@contentful/experience-design-system-backend-pipeline';

export const FIELDS = ['spaceId', 'environmentId', 'cmaToken', 'host'] as const;

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
  return `${use}. If you skip, files are saved locally and nothing is pushed.`;
}

interface Key {
  escape: boolean;
  tab: boolean;
  ctrl: boolean;
}

export type KeyAction = 'back' | 'next-field' | 'skip' | null;

export function keyAction(input: string, key: Key): KeyAction {
  if (key.escape) return 'back';
  if (key.tab) return 'next-field';
  if (key.ctrl && input === 's') return 'skip';
  return null;
}

export function nextField(field: CredentialField): CredentialField {
  return FIELDS[(FIELDS.indexOf(field) + 1) % FIELDS.length]!;
}

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

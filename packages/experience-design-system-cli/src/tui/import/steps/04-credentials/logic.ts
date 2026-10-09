export const FIELDS = ['spaceId', 'environmentId', 'cmaToken', 'host'] as const;

export type CredentialField = (typeof FIELDS)[number];

export interface CredentialValues {
  spaceId: string;
  environmentId: string;
  cmaToken: string;
  host: string;
}

export const DEFAULT_HOST = 'api.contentful.com';

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

export function toConfiguredHost(host: string | undefined): string {
  const value = (host ?? '').trim().replace(/\/+$/, '');
  return value === '' ? DEFAULT_HOST : value.replace(/^https:\/\//i, '');
}

export function toApiHost(host: string): string {
  const value = host.trim().replace(/\/+$/, '');
  if (value === '') return `https://${DEFAULT_HOST}`;
  return /^[a-z][a-z\d+\-.]*:\/\//i.test(value) ? value : `https://${value}`;
}

export function normalize(values: CredentialValues): CredentialValues {
  return {
    spaceId: values.spaceId.trim(),
    environmentId: values.environmentId.trim(),
    cmaToken: values.cmaToken.trim(),
    host: toConfiguredHost(values.host),
  };
}

export function missingField(values: CredentialValues): boolean {
  return values.spaceId === '' || values.environmentId === '' || values.cmaToken === '';
}

export function isUnchanged(current: CredentialValues, initial: CredentialValues): boolean {
  return FIELDS.every((field) => current[field] === initial[field]);
}

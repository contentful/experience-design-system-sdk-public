export const DEFAULT_API_HOST = 'https://api.contentful.com';
export const DEFAULT_CONFIGURED_HOST = 'api.contentful.com';

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeHostInput(host?: string): string | undefined {
  const value = host?.trim();
  if (!value) return undefined;

  return trimTrailingSlashes(value);
}

export function toConfiguredHost(host?: string): string | undefined {
  const normalized = normalizeHostInput(host);
  if (!normalized) return undefined;

  return normalized.replace(/^https:\/\//i, '');
}

export function toApiHost(host?: string): string {
  const normalized = normalizeHostInput(host);
  if (!normalized) return DEFAULT_API_HOST;

  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(normalized)) {
    return normalized;
  }

  return `https://${normalized}`;
}

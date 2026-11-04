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

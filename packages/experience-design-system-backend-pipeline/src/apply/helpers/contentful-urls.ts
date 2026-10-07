import type { BuildPostPushUrlInput } from '../types/contract.js';

function normalizeHost(host: string): string {
  return host
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

function apiHostToAppHost(host: string): string {
  return normalizeHost(host).replace(/^api\./, 'app.');
}

export function buildPostPushUrl({ host, spaceId, environmentId, view = 'components' }: BuildPostPushUrlInput): string {
  const appHost = apiHostToAppHost(host);
  return `https://${appHost}/spaces/${spaceId}/environments/${environmentId}/views/${view}`;
}

type PostPushView = 'components' | 'design_tokens';

export interface BuildPostPushUrlInput {
  host: string;
  spaceId: string;
  environmentId: string;
  view?: PostPushView;
}

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

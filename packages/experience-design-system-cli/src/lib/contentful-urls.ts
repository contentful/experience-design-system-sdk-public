/**
 * Shared Contentful webapp URL builders.
 *
 * The wizard's `done` step and the `experiences import` orchestrator both used
 * to inline the same post-push URL formatter. This module centralizes that
 * formatter so the wizard, `apply push`, and `apply select` all emit the same
 * URL shape.
 */

export type PostPushView = 'components' | 'design_tokens';

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

/**
 * Map a Contentful API host to the corresponding webapp host. For api.*.com
 * inputs this swaps the `api.` prefix to `app.`; any other host is returned
 * as-is (callers get the raw host, no guessing).
 */
export function apiHostToAppHost(host: string): string {
  const normalized = normalizeHost(host);
  return normalized.replace(/^api\./, 'app.');
}

export function buildPostPushUrl({ host, spaceId, environmentId, view = 'components' }: BuildPostPushUrlInput): string {
  const appHost = apiHostToAppHost(host);
  return `https://${appHost}/spaces/${spaceId}/environments/${environmentId}/views/${view}`;
}

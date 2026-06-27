/**
 * Shared Contentful webapp URL builders.
 *
 * The wizard's `done` step and the `experiences import` orchestrator both used
 * to inline the same post-push URL formatter. This module centralizes that
 * formatter so the wizard, `apply push`, and `apply select` all emit the same
 * URL shape.
 *
 * Path: `/views/components` (modern path; the legacy `/exo/components` was
 * replaced in INTEG-4227).
 *
 * Host mapping: api.contentful.com → app.contentful.com,
 *               api.flinkly.com    → app.flinkly.com,
 *               api.quirely.com    → app.quirely.com.
 * Unknown hosts fall through unchanged (no guessing — see the parity-gap-fills
 * spec, "Gap 4 URL host mapping" risk note).
 */

export interface BuildPostPushUrlInput {
  host: string;
  spaceId: string;
  environmentId: string;
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

/**
 * Build the Contentful webapp URL operators see after a successful push.
 * Matches the wizard `done` step's existing output byte-for-byte for
 * `api.contentful.com`.
 */
export function buildPostPushUrl({ host, spaceId, environmentId }: BuildPostPushUrlInput): string {
  const appHost = apiHostToAppHost(host);
  return `https://${appHost}/spaces/${spaceId}/environments/${environmentId}/views/components`;
}

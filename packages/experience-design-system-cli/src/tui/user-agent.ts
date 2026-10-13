import { buildUserAgent } from '@contentful/experience-design-system-backend-pipeline';
import { readPackageVersion } from './upgrade/version.js';

/**
 * The `X-Contentful-User-Agent` for the CLI's requests to the Contentful API, so writes are attributed to the CLI
 * (CEP-0056). Legacy sent the same string, built from its own package version.
 */
export function cliUserAgent(): string {
  return buildUserAgent(readPackageVersion());
}

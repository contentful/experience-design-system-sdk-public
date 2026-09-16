import { createClient, type PlainClientAPI } from 'contentful-management';
import { toConfiguredHost } from '../host-utils.js';

interface CreateCmaClientOptions {
  cmaToken: string;
  /**
   * Optional CMA host override. Accepts either a full URL
   * (`https://api.contentful.com`) or a bare hostname (`api.contentful.com`);
   * contentful-management wants the bare form so we normalize here.
   */
  host?: string;
}

/**
 * Build a plain contentful-management client. Single place that picks the
 * `{ type: 'plain' }` overload so callers never have to think about it,
 * and normalizes host into the bare-hostname shape the SDK expects.
 */
export function createCmaClient(opts: CreateCmaClientOptions): PlainClientAPI {
  return createClient(
    {
      accessToken: opts.cmaToken,
      ...(opts.host ? { host: toConfiguredHost(opts.host) } : {}),
    },
    { type: 'plain' },
  );
}

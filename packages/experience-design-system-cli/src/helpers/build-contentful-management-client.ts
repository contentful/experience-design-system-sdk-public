import { createClient, type PlainClientAPI } from 'contentful-management';
import { toConfiguredHost } from '../host-utils.js';

interface BuildContentfulManagementClientOptions {
  cmaToken: string;
  host?: string;
}

export function buildContentfulManagementClient(opts: BuildContentfulManagementClientOptions): PlainClientAPI {
  return createClient(
    {
      accessToken: opts.cmaToken,
      ...(opts.host ? { host: toConfiguredHost(opts.host) } : {}),
    },
    { type: 'plain' },
  );
}

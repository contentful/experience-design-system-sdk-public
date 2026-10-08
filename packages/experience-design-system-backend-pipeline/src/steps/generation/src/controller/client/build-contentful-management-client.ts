import { createClient, type PlainClientAPI } from 'contentful-management';
import { toConfiguredHost } from '../../../../apply/src/helpers/host-utils.js';

export interface BuildContentfulManagementClientRequest {
  cmaToken: string;
  host?: string;
}

/** Factory for the Contentful Management API `PlainClientAPI`. */
export function buildContentfulManagementClient(request: BuildContentfulManagementClientRequest): PlainClientAPI {
  return createClient(
    {
      accessToken: request.cmaToken,
      ...(request.host ? { host: toConfiguredHost(request.host) } : {}),
    },
    { type: 'plain' },
  );
}

import { ApiClient } from './api-client/api-client.js';
import type { ApplyCredentials } from '../types/contract.js';

export function createApiClient(credentials: ApplyCredentials): ApiClient {
  return new ApiClient({
    host: credentials.host,
    cmaToken: credentials.accessToken,
    spaceId: credentials.spaceId,
    environmentId: credentials.environmentId,
  });
}

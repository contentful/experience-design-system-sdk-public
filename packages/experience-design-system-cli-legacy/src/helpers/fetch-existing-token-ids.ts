import { fetchAll, type PlainClientAPI } from 'contentful-management';
import { buildContentfulManagementClient } from './build-contentful-management-client.js';

export interface FetchExistingTokenIdsParams {
  spaceId: string;
  environmentId: string;
  cmaToken: string;
  host?: string;
}

/**
 * The ids of every design token in the target environment (for example `color.primary`).
 * Only tokens are read, so a component list that the server cannot serialize does not matter.
 */
export async function fetchExistingTokenIds(params: FetchExistingTokenIdsParams): Promise<Set<string>> {
  const client = buildContentfulManagementClient({
    cmaToken: params.cmaToken,
    ...(params.host ? { host: params.host } : {}),
  });
  const tokens = await fetchAll(client.designToken.getMany, {
    spaceId: params.spaceId,
    environmentId: params.environmentId,
    query: { cursor: true, limit: 1000 } as unknown as Parameters<PlainClientAPI['designToken']['getMany']>[0]['query'],
  });
  return new Set(tokens.map((token) => token.sys.id));
}

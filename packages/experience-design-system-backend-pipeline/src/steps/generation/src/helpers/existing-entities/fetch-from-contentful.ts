import { fetchAll, type PlainClientAPI } from 'contentful-management';
import type { ExistingContentfulEntities } from '../../types/existing-entities.js';

export interface FetchExistingEntitiesParams {
  spaceId: string;
  environmentId: string;
}

/** Pulls every Component + DesignToken from a space/env using cursor pagination. */
export async function fetchExistingContentfulEntitiesFromContentful(
  client: PlainClientAPI,
  params: FetchExistingEntitiesParams,
): Promise<ExistingContentfulEntities> {
  const componentScope = {
    spaceId: params.spaceId,
    environmentId: params.environmentId,
    query: { cursor: true, limit: 1000 } as unknown as Parameters<PlainClientAPI['component']['getMany']>[0]['query'],
  };
  const tokenScope = {
    spaceId: params.spaceId,
    environmentId: params.environmentId,
    query: { cursor: true, limit: 1000 } as unknown as Parameters<PlainClientAPI['designToken']['getMany']>[0]['query'],
  };
  const components = await fetchAll(client.component.getMany, componentScope);
  const tokens = await fetchAll(client.designToken.getMany, tokenScope);
  return { components, tokens };
}

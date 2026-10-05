import { fetchAll, type ComponentProps, type DesignTokenProps, type PlainClientAPI } from 'contentful-management';

export interface ExistingContentfulEntities {
  components: ComponentProps[];
  tokens: DesignTokenProps[];
}

interface FetchExistingContentfulEntitiesParams {
  spaceId: string;
  environmentId: string;
}

export async function fetchExistingContentfulEntitiesFromContentful(
  client: PlainClientAPI,
  params: FetchExistingContentfulEntitiesParams,
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

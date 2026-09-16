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
  const scope = { spaceId: params.spaceId, environmentId: params.environmentId, query: {} };
  const components = await fetchAll(client.component.getMany, scope);
  const tokens = await fetchAll(client.designToken.getMany, scope);
  return { components, tokens };
}

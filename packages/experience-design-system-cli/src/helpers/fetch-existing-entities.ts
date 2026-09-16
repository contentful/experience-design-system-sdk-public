import { fetchAll, type ComponentProps, type DesignTokenProps, type PlainClientAPI } from 'contentful-management';

export interface ExistingEntities {
  components: ComponentProps[];
  tokens: DesignTokenProps[];
}

interface FetchExistingEntitiesParams {
  spaceId: string;
  environmentId: string;
}

/**
 * Fetch all existing Components + DesignTokens for a space+env. Pagination
 * is delegated to the SDK's `fetchAll()` helper. Caller supplies the
 * pre-built plain client (see `createCmaClient()`).
 */
export async function fetchExistingEntities(
  client: PlainClientAPI,
  params: FetchExistingEntitiesParams,
): Promise<ExistingEntities> {
  const scope = { spaceId: params.spaceId, environmentId: params.environmentId, query: {} };
  const [components, tokens] = await Promise.all([
    fetchAll(client.component.getMany, scope),
    fetchAll(client.designToken.getMany, scope),
  ]);
  return { components, tokens };
}

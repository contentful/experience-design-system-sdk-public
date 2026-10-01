import { describe, expect, it, vi } from 'vitest';
import type { PlainClientAPI } from 'contentful-management';

const { fetchAll } = vi.hoisted(() => ({ fetchAll: vi.fn().mockResolvedValue([]) }));

vi.mock('contentful-management', async (importOriginal) => ({
  ...(await importOriginal<typeof import('contentful-management')>()),
  fetchAll,
}));

import { fetchExistingContentfulEntitiesFromContentful } from '../../src/helpers/fetch-existing-contentful-entities.js';

describe('fetchExistingContentfulEntitiesFromContentful', () => {
  it('requests cursor pagination for components and design tokens', async () => {
    const client = {
      component: { getMany: vi.fn() },
      designToken: { getMany: vi.fn() },
    } as unknown as PlainClientAPI;

    await fetchExistingContentfulEntitiesFromContentful(client, {
      spaceId: 'space-id',
      environmentId: 'environment-id',
    });

    expect(fetchAll).toHaveBeenNthCalledWith(1, client.component.getMany, {
      spaceId: 'space-id',
      environmentId: 'environment-id',
      query: { cursor: true, limit: 1000 },
    });
    expect(fetchAll).toHaveBeenNthCalledWith(2, client.designToken.getMany, {
      spaceId: 'space-id',
      environmentId: 'environment-id',
      query: { cursor: true, limit: 1000 },
    });
  });
});

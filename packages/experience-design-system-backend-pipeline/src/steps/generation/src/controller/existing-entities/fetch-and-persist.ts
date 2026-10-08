import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildContentfulManagementClient } from '../client/build-contentful-management-client.js';
import { fetchExistingContentfulEntitiesFromContentful } from '../../helpers/existing-entities/fetch-from-contentful.js';
import type { ExistingContentfulEntities } from '../../types/existing-entities.js';

export interface FetchAndPersistExistingEntitiesRequest {
  cmaToken: string;
  host?: string;
  spaceId: string;
  environmentId: string;
  outDir: string;
}

export interface FetchAndPersistSuccess {
  ok: true;
  path: string;
  durationMs: number;
  entities: ExistingContentfulEntities;
}

export interface FetchAndPersistFailure {
  ok: false;
  durationMs: number;
  error: string;
}

export type FetchAndPersistResult = FetchAndPersistSuccess | FetchAndPersistFailure;

/**
 * Pre-generation sync: fetch existing Components + DesignTokens from the
 * target space/env, then persist them to `<outDir>/.existing-entities.json`
 * for `readExistingContentfulEntitiesFromSession` to read on later steps.
 */
export async function fetchAndPersistExistingContentfulEntities(
  request: FetchAndPersistExistingEntitiesRequest,
): Promise<FetchAndPersistResult> {
  const t0 = Date.now();
  try {
    const client = buildContentfulManagementClient({
      cmaToken: request.cmaToken,
      ...(request.host ? { host: request.host } : {}),
    });
    const entities = await fetchExistingContentfulEntitiesFromContentful(client, {
      spaceId: request.spaceId,
      environmentId: request.environmentId,
    });
    const path = join(request.outDir, '.existing-entities.json');
    await writeFile(path, JSON.stringify(entities, null, 2), 'utf8');
    return { ok: true, path, durationMs: Date.now() - t0, entities };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - t0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

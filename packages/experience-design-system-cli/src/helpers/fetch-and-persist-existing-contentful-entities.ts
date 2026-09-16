import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildContentfulManagementClient } from './build-contentful-management-client.js';
import {
  fetchExistingContentfulEntitiesFromContentful,
  type ExistingContentfulEntities,
} from './fetch-existing-contentful-entities.js';

export interface FetchAndPersistParams {
  spaceId: string;
  environmentId: string;
  cmaToken: string;
  host?: string;
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
 * Build the Contentful management client, fetch the target space's Components
 * and DesignTokens, and write the raw payload to `<outDir>/.existing-entities.json`.
 *
 * Never throws — a failure is reported via `ok: false`. Callers own the
 * user-facing step/progress reporting. This helper only handles the mechanical
 * fetch-then-write and returns a structured result.
 */
export async function fetchAndPersistExistingContentfulEntities(
  params: FetchAndPersistParams,
): Promise<FetchAndPersistResult> {
  const t0 = Date.now();
  try {
    const client = buildContentfulManagementClient({
      cmaToken: params.cmaToken,
      ...(params.host ? { host: params.host } : {}),
    });
    const entities = await fetchExistingContentfulEntitiesFromContentful(client, {
      spaceId: params.spaceId,
      environmentId: params.environmentId,
    });
    const path = join(params.outDir, '.existing-entities.json');
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

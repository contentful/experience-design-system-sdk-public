import { readExistingContentfulEntitiesFromSession } from '../../../steps/generation/src/controller/existing-entities/read-from-session.js';
import type { ExistingContentfulEntities } from '../../../steps/generation/src/types/existing-entities.js';

export interface ReadExistingEntitiesRequest {
  existingContentfulEntities?: ExistingContentfulEntities | null;
  existingEntitiesPath?: string | null;
}

/**
 * Resolves the existing-Contentful-entities projection the generate/map-tokens
 * agents receive. The pre-materialized value wins when the caller passed one;
 * otherwise reads the on-disk `.existing-entities.json` the credentials step
 * wrote. Returns `undefined` when neither source is available.
 */
export async function readExistingEntities(
  request: ReadExistingEntitiesRequest,
): Promise<ExistingContentfulEntities | null | undefined> {
  if (request.existingContentfulEntities !== undefined) return request.existingContentfulEntities;
  if (!request.existingEntitiesPath) return undefined;
  return readExistingContentfulEntitiesFromSession({ path: request.existingEntitiesPath });
}

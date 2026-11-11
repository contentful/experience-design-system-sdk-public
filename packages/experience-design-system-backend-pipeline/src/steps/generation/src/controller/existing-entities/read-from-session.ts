import { readFile } from 'node:fs/promises';
import type { ExistingContentfulEntities } from '../../types/existing-entities.js';

export interface ReadExistingEntitiesFromSessionRequest {
  path: string | undefined;
}

/** Load the on-disk `.existing-entities.json` written by fetch-and-persist. Returns undefined on any read/parse failure. */
export async function readExistingContentfulEntitiesFromSession(
  request: ReadExistingEntitiesFromSessionRequest,
): Promise<ExistingContentfulEntities | undefined> {
  if (!request.path) return undefined;
  try {
    const raw = await readFile(request.path, 'utf8');
    const parsed = JSON.parse(raw) as ExistingContentfulEntities;
    if (!Array.isArray(parsed.components) || !Array.isArray(parsed.tokens)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

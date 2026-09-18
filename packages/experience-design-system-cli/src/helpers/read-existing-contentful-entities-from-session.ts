import { readFile } from 'node:fs/promises';
import type { ExistingContentfulEntities } from './fetch-existing-contentful-entities.js';

/**
 * Read the session file the orchestrator writes after
 * `fetchExistingContentfulEntitiesFromContentful()`. Returns undefined on
 * any failure — this is optional enrichment and must never block the step.
 */
export async function readExistingContentfulEntitiesFromSession(
  path: string | undefined,
): Promise<ExistingContentfulEntities | undefined> {
  if (!path) return undefined;
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as ExistingContentfulEntities;
    if (!Array.isArray(parsed.components) || !Array.isArray(parsed.tokens)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

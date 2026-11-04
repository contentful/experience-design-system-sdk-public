import type { ExistingContentfulEntities } from '../../steps/generation/src/types/existing-entities.js';

export interface CheckGenerateComponentsCacheRequest {
  sessionId: string;
  agent: string;
  agentModel?: string;
  promptOverrides: string[];
  existingEntitiesPath?: string | null;
  existingContentfulEntities?: ExistingContentfulEntities | null;
  noCache: boolean;

  restoreCache: boolean;
}

export interface CheckGenerateComponentsCacheResponse {
  sessionId: string;

  cachedComponentNames: string[];

  fullyCached: boolean;

  cacheDisabled: boolean;
}

export async function checkGenerateComponentsCache(
  request: CheckGenerateComponentsCacheRequest,
): Promise<CheckGenerateComponentsCacheResponse> {
  return { sessionId: request.sessionId, cachedComponentNames: [], fullyCached: false, cacheDisabled: true };
}

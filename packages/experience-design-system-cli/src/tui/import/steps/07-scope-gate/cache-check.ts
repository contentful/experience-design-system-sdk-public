import { checkGenerateComponentsCache } from '@contentful/experience-design-system-backend-pipeline';

export interface CacheCheckInput {
  sessionId: string;
  tokensPath: string;
  agent: string;
  agentModel?: string;
  promptOverrides: string[];
  existingEntitiesPath: string | null;
  noCache: boolean;
}

/**
 * Runs the generation cache check in-process while the scope gate is open.
 * Restores cached CDF entries into the pipeline database as a side-effect so
 * the generate run that follows can skip them. A failed check is
 * indistinguishable from "nothing cached", as in legacy. INTEG-5050 tracks
 * surfacing it.
 */
export async function checkGenerationCache(input: CacheCheckInput): Promise<string[]> {
  if (input.noCache) return [];
  try {
    const result = await checkGenerateComponentsCache({
      sessionId: input.sessionId,
      agent: input.agent,
      ...(input.agentModel ? { agentModel: input.agentModel } : {}),
      promptOverrides: input.promptOverrides,
      existingEntitiesPath: input.existingEntitiesPath,
      noCache: input.noCache,
      restoreCache: true,
    });
    return result.cachedComponentNames;
  } catch {
    return [];
  }
}

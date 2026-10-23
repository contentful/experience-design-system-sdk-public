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

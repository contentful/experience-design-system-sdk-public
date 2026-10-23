import { summarizeForMapTokens } from '../../steps/generation/src/controller/existing-entities/summarize-for-map-tokens.js';
import { resolveComponentCache } from '../../steps/generation/src/helpers/components/resolve-component-cache.js';
import { loadRawComponents, openPipelineDb } from '../../persistence/src/session/repositories/db.js';
import { hashContent, hashPromptForSkill } from '../../persistence/src/session/helpers/cache-keys.js';
import { loadAcceptedNames } from '../../persistence/src/index.js';
import type { AgentName } from '../../agents/types/agent-name.js';
import type { ExistingContentfulEntities } from '../../steps/generation/src/types/existing-entities.js';
import { readExistingEntities } from './helpers/read-existing-entities.js';
import { resolveGeneratePrompt } from './helpers/resolve-generate-prompt.js';
import { restoreCachedComponents } from './helpers/restore-cached-components.js';

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
  if (request.noCache) {
    return { sessionId: request.sessionId, cachedComponentNames: [], fullyCached: false, cacheDisabled: true };
  }

  const existingEntities = await readExistingEntities(request);
  const existingTokensInline = existingEntities
    ? JSON.stringify(summarizeForMapTokens({ entities: existingEntities }))
    : undefined;
  const prompt = await resolveGeneratePrompt(request.promptOverrides);
  const agent = request.agent as AgentName;
  const promptHash = await hashPromptForSkill(
    'components',
    agent,
    request.agentModel,
    prompt.path,
    existingTokensInline ? [hashContent(existingTokensInline)] : [],
    prompt.text,
  );

  const db = openPipelineDb();
  try {
    const acceptedNames = await loadAcceptedNames(request.sessionId);
    const components = loadRawComponents(db, request.sessionId, acceptedNames ?? undefined);
    if (components.length === 0) {
      return { sessionId: request.sessionId, cachedComponentNames: [], fullyCached: false, cacheDisabled: false };
    }

    const allowedComponentNames = new Set([
      ...components.map((component) => component.name),
      ...(existingEntities?.components ?? []).map((component) => component.name),
    ]);

    const cachedComponents: Array<{
      component: (typeof components)[number];
      resolution: NonNullable<ReturnType<typeof resolveComponentCache>>;
    }> = [];
    for (const component of components) {
      const resolution = resolveComponentCache(db, component, promptHash, allowedComponentNames);
      if (resolution) cachedComponents.push({ component, resolution });
      await new Promise<void>((r) => setImmediate(r));
    }

    if (request.restoreCache) {
      await restoreCachedComponents(db, request.sessionId, cachedComponents, promptHash, allowedComponentNames);
    }

    return {
      sessionId: request.sessionId,
      cachedComponentNames: cachedComponents.map(({ component }) => component.name),
      fullyCached: cachedComponents.length === components.length,
      cacheDisabled: false,
    };
  } finally {
    db.close();
  }
}

import type { DatabaseSync } from 'node:sqlite';
import { readExistingContentfulEntitiesFromSession } from '../../steps/generation/src/controller/existing-entities/read-from-session.js';
import { summarizeForMapTokens } from '../../steps/generation/src/controller/existing-entities/summarize-for-map-tokens.js';
import { resolveComponentCache } from '../../steps/generation/src/helpers/components/resolve-component-cache.js';
import { normalizeComponentForCache } from '../../steps/generation/src/helpers/components/normalize-component-for-cache.js';
import {
  computeComponentInputHash,
  copyComponentsFromCache,
  loadRawComponents,
  openPipelineDb,
  renameEmptySlots,
  storeCaches,
  type RawComponentWithId,
} from '../../persistence/src/session/repositories/db.js';
import { hashContent, hashPromptForSkill } from '../../persistence/src/session/helpers/cache-keys.js';
import { loadAcceptedNames } from '../../persistence/src/index.js';
import type { AgentName } from '../../agents/types/agent-name.js';
import type { ExistingContentfulEntities } from '../../steps/generation/src/types/existing-entities.js';
import { resolveGeneratePrompt } from './helpers/resolve-generate-prompt.js';

export interface CheckGenerateComponentsCacheRequest {
  sessionId: string;
  agent: string;
  agentModel?: string;
  promptOverrides: string[];
  existingEntitiesPath?: string | null;
  existingContentfulEntities?: ExistingContentfulEntities | null;
  noCache: boolean;
  /**
   * When true: restore cached components back into the session DB so the next
   * run can skip them. Mirrors legacy `--restore-cache`.
   */
  restoreCache: boolean;
}

export interface CheckGenerateComponentsCacheResponse {
  sessionId: string;
  /** Names of components whose cache entries resolved (and were restored, if requested). */
  cachedComponentNames: string[];
  /** True when every raw component in the session was cached. */
  fullyCached: boolean;
  /** True when the cache was disabled (`noCache` set) — the result is always empty then. */
  cacheDisabled: boolean;
}

/**
 * Mirrors legacy `__generate components --cache-status --restore-cache`.
 * Opens its own DB handle so step 07's cache-check (which runs while the user
 * sits at the scope gate) can call it independently from runs that generate.
 */
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

    const cachedComponents = components.flatMap((component) => {
      const resolution = resolveComponentCache(db, component, promptHash, allowedComponentNames);
      return resolution ? [{ component, resolution }] : [];
    });

    if (request.restoreCache) restoreCached(db, request.sessionId, cachedComponents, promptHash, allowedComponentNames);

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

async function readExistingEntities(
  request: CheckGenerateComponentsCacheRequest,
): Promise<ExistingContentfulEntities | null | undefined> {
  if (request.existingContentfulEntities !== undefined) return request.existingContentfulEntities;
  if (!request.existingEntitiesPath) return undefined;
  return readExistingContentfulEntitiesFromSession({ path: request.existingEntitiesPath });
}

function restoreCached(
  db: DatabaseSync,
  sessionId: string,
  cachedComponents: Array<{
    component: RawComponentWithId;
    resolution: NonNullable<ReturnType<typeof resolveComponentCache>>;
  }>,
  promptHash: string,
  allowedComponentNames: ReadonlySet<string>,
): void {
  const restorations: Array<{ sourceSessionId: string; targetSessionId: string; componentId: string }> = [];
  const rekeyed: Array<{ component: RawComponentWithId; cached: { sourceSessionId: string; humanEdited: boolean } }> =
    [];
  const componentStatus = db.prepare('SELECT status FROM raw_components WHERE session_id = ? AND component_id = ?');
  for (const { component, resolution } of cachedComponents) {
    const current = componentStatus.get(sessionId, component.component_id) as { status: string } | undefined;
    if (current?.status === 'generated') continue;
    renameEmptySlots(db, sessionId, component.component_id, component.name, component.slots.length);
    restorations.push({
      sourceSessionId: resolution.entry.sourceSessionId,
      targetSessionId: sessionId,
      componentId: component.component_id,
    });
    rekeyed.push({ component, cached: resolution.entry });
  }
  copyComponentsFromCache(db, restorations, { allowedComponentNames });
  storeCaches(
    db,
    rekeyed.map(({ component, cached }) => ({
      inputHash: computeComponentInputHash(normalizeComponentForCache(component)),
      entityType: 'component' as const,
      entityId: component.component_id,
      sourceSessionId: cached.sourceSessionId,
      humanEdited: cached.humanEdited,
      promptHash,
    })),
  );
}

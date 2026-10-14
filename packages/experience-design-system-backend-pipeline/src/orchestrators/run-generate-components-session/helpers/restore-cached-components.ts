import type { DatabaseSync } from 'node:sqlite';
import {
  computeComponentInputHash,
  copyComponentsFromCache,
  renameEmptySlots,
  storeCaches,
  type RawComponentWithId,
} from '../../../persistence/src/session/repositories/db.js';
import { normalizeComponentForCache } from '../../../steps/generation/src/helpers/components/normalize-component-for-cache.js';
import type { resolveComponentCache } from '../../../steps/generation/src/helpers/components/resolve-component-cache.js';

export type RestoreCandidate = {
  component: RawComponentWithId;
  resolution: NonNullable<ReturnType<typeof resolveComponentCache>>;
};

export function restoreCachedComponents(
  db: DatabaseSync,
  sessionId: string,
  cachedComponents: RestoreCandidate[],
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

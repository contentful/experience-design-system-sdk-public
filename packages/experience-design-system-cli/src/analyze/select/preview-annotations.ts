import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';
import type { PreviewAnnotation } from './types.js';

/**
 * Pure mapper from a `ServerPreviewResponse` to a per-component-name
 * `PreviewAnnotation` map. Consumed by the wizard's final-review sidebar
 * (and any other surface that wants to render diff badges next to a
 * component row).
 *
 * The `new` bucket of `ServerPreviewResponse.components` is `CDFComponentEntry[]`
 * — those entries do NOT carry a `name` field on the wire (the name is the
 * KEY in the parent manifest). So instead of trying to read names off entries,
 * we derive the "new" set as:
 *
 *   new = localNames \ (unchangedNames ∪ changedNames ∪ removedNames)
 *
 * Callers must pass the local manifest's component keys as `localNames` so
 * we can perform the set difference. Removed components from the server that
 * aren't in the local manifest are still annotated as `'removed'` (so the
 * detail panel can list them).
 *
 * Precedence: `breaking` > `changed` > `removed` > `new`.
 *
 * Unchanged entries are omitted from the map — callers should treat
 * `map.get(name) === undefined` as "no annotation".
 */
export function applyPreviewAnnotations(
  preview: ServerPreviewResponse,
  localNames: readonly string[],
): Map<string, PreviewAnnotation> {
  const out = new Map<string, PreviewAnnotation>();

  const unchanged = new Set(preview.components.unchanged);

  // Annotate changed first; collect their names so we can exclude from "new".
  const changedNames = new Set<string>();
  for (const item of preview.components.changed) {
    const name = item.current?.name;
    if (typeof name !== 'string') continue;
    changedNames.add(name);
    if (item.changeClassification?.classification === 'breaking') {
      out.set(name, 'breaking');
    } else {
      out.set(name, 'changed');
    }
  }

  // Annotate removed.
  const removedNames = new Set<string>();
  for (const entity of preview.components.removed) {
    if (entity.name) {
      removedNames.add(entity.name);
      out.set(entity.name, 'removed');
    }
  }

  // Derive `new` = localNames \ (unchanged ∪ changed ∪ removed).
  for (const name of localNames) {
    if (unchanged.has(name)) continue;
    if (changedNames.has(name)) continue;
    if (removedNames.has(name)) continue;
    if (out.has(name)) continue;
    out.set(name, 'new');
  }

  return out;
}

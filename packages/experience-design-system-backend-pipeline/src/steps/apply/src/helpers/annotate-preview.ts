import type { ServerPreviewResponse } from '../../../shared/index.js';
import type { PreviewAnnotation } from '../types/preview-annotation.js';

/**
 * Pure diff mapper: `ServerPreviewResponse` + local component names →
 * `Map<name, PreviewAnnotation>`. Omits `unchanged` entries from the map.
 * Precedence: `breaking` > `changed` > `removed` > `new`.
 */
export function annotatePreview(
  preview: ServerPreviewResponse,
  localNames: readonly string[],
): Map<string, PreviewAnnotation> {
  const out = new Map<string, PreviewAnnotation>();
  const unchanged = new Set(preview.components.unchanged);

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

  const removedNames = new Set<string>();
  for (const entity of preview.components.removed) {
    if (entity.name) {
      removedNames.add(entity.name);
      out.set(entity.name, 'removed');
    }
  }

  for (const name of localNames) {
    if (unchanged.has(name)) continue;
    if (changedNames.has(name)) continue;
    if (removedNames.has(name)) continue;
    if (out.has(name)) continue;
    out.set(name, 'new');
  }

  return out;
}

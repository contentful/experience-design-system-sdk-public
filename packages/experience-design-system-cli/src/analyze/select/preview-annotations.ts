import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';
import type { PreviewAnnotation } from './types.js';

/**
 * Pure mapper from a `ServerPreviewResponse` to a per-component-name
 * `PreviewAnnotation` map. Consumed by the wizard's final-review sidebar
 * (and any other surface that wants to render diff badges next to a
 * component row).
 *
 * Precedence: `breaking` > `changed` > `new` > `removed`. (A single name
 * shouldn't appear in more than one bucket in practice; we walk the arrays
 * in a fixed order so the result is deterministic if one ever does.)
 *
 * Unchanged entries are omitted from the map — callers should treat
 * `map.get(name) === undefined` as "no annotation".
 */
export function applyPreviewAnnotations(preview: ServerPreviewResponse): Map<string, PreviewAnnotation> {
  const out = new Map<string, PreviewAnnotation>();

  // `removed` first so `new` / `changed` can override if a name somehow
  // appears in two buckets (defensive — shouldn't happen).
  for (const entity of preview.components.removed) {
    if (entity.name) out.set(entity.name, 'removed');
  }

  for (const entry of preview.components.new) {
    // `new` items are CDFComponentEntry but the server attaches the name on
    // the serialized payload — mirror the WizardApp.tsx access pattern at
    // lines 332-333.
    const name = (entry as unknown as Record<string, unknown>)['name'];
    if (typeof name === 'string') out.set(name, 'new');
  }

  for (const item of preview.components.changed) {
    const name = item.current?.name ?? (item.proposed as unknown as Record<string, unknown>)?.['name'];
    if (typeof name !== 'string') continue;
    if (item.changeClassification?.classification === 'breaking') {
      out.set(name, 'breaking');
    } else {
      out.set(name, 'changed');
    }
  }

  return out;
}

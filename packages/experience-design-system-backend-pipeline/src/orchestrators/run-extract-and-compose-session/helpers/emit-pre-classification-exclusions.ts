import { preClassifyProp } from '../../../steps/extraction/src/helpers/pre-classify.js';
import type { ComponentExtractionResult } from '../../../steps/extraction/src/types/component.js';

/**
 * Fire the caller's exclusion sink for every pre-classification exclusion:
 *   - whole-component exclusions reported by the extractor itself
 *   - individual props that pre-classification tags as `category: 'exclude'`
 *     (deterministic wiring-prop filter, e.g. React's `onClick`, `className`)
 */
export function emitPreClassificationExclusions(
  extraction: ComponentExtractionResult,
  onExclusion: ((exclusion: Record<string, unknown>) => void) | undefined,
): void {
  if (!onExclusion) return;

  for (const exclusion of extraction.exclusions ?? []) {
    onExclusion({ ...exclusion });
  }
  for (const component of extraction.components) {
    for (const prop of component.props) {
      if (preClassifyProp(prop)?.category === 'exclude') {
        onExclusion({
          itemType: 'prop',
          name: prop.name,
          source: component.source,
          component: component.name,
          reason: 'deterministic pre-classification excluded this wiring prop',
          stage: 'pre-classify',
        });
      }
    }
  }
}

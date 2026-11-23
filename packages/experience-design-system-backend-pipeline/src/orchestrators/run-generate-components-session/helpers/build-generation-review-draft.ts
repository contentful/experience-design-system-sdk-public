import type { RawPropDefinition } from '../../../steps/extraction/src/types/component.js';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { readToolCallObjects } from '../../../agents/parsers/helpers/read-tool-call-objects.js';

/** Preserve the final proposal's invalid fields for review rather than parsing them away. */
export function buildGenerationReviewDraft(
  stdout: string,
  base: CDFComponentEntry,
  extractedProps: readonly RawPropDefinition[],
): CDFComponentEntry {
  const entry: Record<string, unknown> = { ...base };
  const properties = new Map(Object.entries(base.$properties as unknown as Record<string, Record<string, unknown>>));
  const slots = new Map<string, Record<string, unknown>>(Object.entries(base.$slots ?? {}));
  for (const call of readToolCallObjects(stdout).objects) {
    if (call.tool === 'classify_component' && Object.hasOwn(call, 'description')) entry.$description = call.description;
    if (call.tool === 'classify_prop' && typeof call.prop === 'string' && call.prop) {
      const property: Record<string, unknown> = {};
      const fields = {
        cdf_type: '$type',
        cdf_category: '$category',
        token_kind: '$token.kind',
        values: '$values',
        required: '$required',
        description: '$description',
        default: '$default',
      };
      for (const [source, target] of Object.entries(fields)) {
        if (Object.hasOwn(call, source)) property[target] = call[source];
      }
      properties.set(call.prop, property);
    } else if (call.tool === 'exclude_prop' && typeof call.prop === 'string' && call.prop) {
      const extracted = extractedProps.find((prop) => prop.name === call.prop);
      properties.set(call.prop, {
        $type: extracted?.type === 'boolean' ? 'boolean' : 'string',
        $category: 'unattached',
      });
    } else if (call.tool === 'classify_slot' && typeof call.slot === 'string' && call.slot) {
      const slot: Record<string, unknown> = {};
      for (const [source, target] of Object.entries({
        required: '$required',
        description: '$description',
        allowed_components: '$allowedComponents',
      })) {
        if (Object.hasOwn(call, source)) slot[target] = call[source];
      }
      slots.set(call.slot, slot);
    }
  }
  entry.$properties = Object.fromEntries(properties);
  if (slots.size > 0) entry.$slots = Object.fromEntries(slots);
  // This is editable CDF-shaped data, intentionally not a schema-valid document.
  return entry as unknown as CDFComponentEntry;
}

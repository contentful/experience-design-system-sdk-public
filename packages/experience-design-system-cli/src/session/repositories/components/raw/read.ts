import type { DatabaseSync } from 'node:sqlite';
import type { RawComponentDefinition, RawPropDefinition, RawSlotDefinition } from '../../../../types.js';
import { indexRowsByKey } from '../../../core/shared/index-rows-by-key.js';
import { parseReviewReasons } from './row-mappers.js';
import { getRawComponentRows } from './reads/get-raw-component-rows.js';
import { getRawPropRows } from './reads/get-raw-prop-rows.js';
import { getRawPropAllowedValueRows } from './reads/get-raw-prop-allowed-value-rows.js';
import { getRawSlotRows } from './reads/get-raw-slot-rows.js';
import { getRawSlotAllowedComponentRows } from './reads/get-raw-slot-allowed-component-rows.js';

export type { RawComponentRow, RawPropRow, RawSlotRow, RawSlotAllowedComponentRow } from './rows.js';
export {
  mapRawComponentRow,
  mapRawPropRow,
  mapRawSlotRow,
  mapRawSlotAllowedComponentRow,
  mapAllowedValueSnapshotRow,
  parseReviewReasons,
} from './row-mappers.js';
export { getRawComponentRows } from './reads/get-raw-component-rows.js';
export { getRawPropRows } from './reads/get-raw-prop-rows.js';
export { getRawPropAllowedValueRows } from './reads/get-raw-prop-allowed-value-rows.js';
export { getRawSlotRows } from './reads/get-raw-slot-rows.js';
export { getRawSlotAllowedComponentRows } from './reads/get-raw-slot-allowed-component-rows.js';
export { getClassifiedProps } from './reads/get-classified-props.js';
export { getComponentDescriptions } from './reads/get-component-descriptions.js';
export { getRawPropAllowedValues } from './reads/get-raw-prop-allowed-values.js';
export { getRawPropNameAtPosition } from './reads/get-raw-prop-name-at-position.js';

export type RawComponentWithId = RawComponentDefinition & {
  component_id: string;
};

// Composer: reads every raw_* table for a session and reassembles the
// RawComponentWithId payload (props + slots + allowed values/components).
// Each SELECT lives in its own file under reads/; this function only owns
// the fan-out + row-index-by-key merge logic.
export function getRawComponents(
  db: DatabaseSync,
  sessionId: string,
  allowedNames?: Set<string>,
): RawComponentWithId[] {
  const all = getRawComponentRows(db, sessionId);
  const components = allowedNames ? all.filter((c) => allowedNames.has(c.name)) : all;
  if (components.length === 0) return [];

  const props = getRawPropRows(db, sessionId);
  const allowedValues = getRawPropAllowedValueRows(db, sessionId);
  const slots = getRawSlotRows(db, sessionId);
  const allowedComponents = getRawSlotAllowedComponentRows(db, sessionId);

  const propsByComponent = indexRowsByKey(props, (p) => p.component_id);
  const allowedValuesByProp = indexRowsByKey(allowedValues, (av) => `${av.component_id}::${av.prop_name}`);
  const slotsByComponent = indexRowsByKey(slots, (s) => s.component_id);
  const allowedComponentsBySlot = indexRowsByKey(allowedComponents, (ac) => `${ac.component_id}::${ac.slot_name}`);

  return components.map(
    (c): RawComponentWithId => ({
      component_id: c.component_id,
      name: c.name,
      source: c.source,
      framework: c.framework as RawComponentDefinition['framework'],
      extractionConfidence: c.extraction_confidence ?? null,
      reviewReasons: parseReviewReasons(c.review_reasons),
      needsReview: Boolean(c.needs_review),
      sourcePath: c.source_path ?? undefined,
      props: (propsByComponent.get(c.component_id) ?? []).map((p): RawPropDefinition => {
        const av = allowedValuesByProp.get(`${c.component_id}::${p.name}`);
        const prop: RawPropDefinition = {
          name: p.name,
          type: p.type,
          required: Boolean(p.required),
        };
        if (p.category !== null) prop.category = p.category as RawPropDefinition['category'];
        if (p.default_value !== null) prop.defaultValue = p.default_value;
        if (p.description !== null) prop.description = p.description;
        if (p.token_reference !== null) prop.tokenReference = p.token_reference;
        if (av && av.length > 0) prop.allowedValues = av.map((v) => v.value);
        if (p.source_start_line !== null) prop.sourceStartLine = p.source_start_line;
        if (p.source_end_line !== null) prop.sourceEndLine = p.source_end_line;
        return prop;
      }),
      slots: (slotsByComponent.get(c.component_id) ?? []).map((s): RawSlotDefinition => {
        const ac = allowedComponentsBySlot.get(`${c.component_id}::${s.name}`);
        const slot: RawSlotDefinition = {
          name: s.name,
          isDefault: Boolean(s.is_default),
        };
        if (s.description !== null) slot.description = s.description;
        if (ac && ac.length > 0) slot.allowedComponents = ac.map((v) => v.allowed_component);
        return slot;
      }),
    }),
  );
}

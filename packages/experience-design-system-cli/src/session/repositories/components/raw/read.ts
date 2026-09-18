import type { DatabaseSync } from 'node:sqlite';
import { indexRowsByKey } from '../../../core/shared/index-rows-by-key.js';
import {
  mapRawComponentToWithId,
  type RawComponentWithId,
} from '../../../core/components/mappers/map-raw-component-to-with-id.js';
import { mapRawPropToDefinition } from '../../../core/components/mappers/map-raw-prop-to-definition.js';
import { mapRawSlotToDefinition } from '../../../core/components/mappers/map-raw-slot-to-definition.js';
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
export type { RawComponentWithId } from '../../../core/components/mappers/map-raw-component-to-with-id.js';
export { getRawComponentRows } from './reads/get-raw-component-rows.js';
export { getRawPropRows } from './reads/get-raw-prop-rows.js';
export { getRawPropAllowedValueRows } from './reads/get-raw-prop-allowed-value-rows.js';
export { getRawSlotRows } from './reads/get-raw-slot-rows.js';
export { getRawSlotAllowedComponentRows } from './reads/get-raw-slot-allowed-component-rows.js';
export { getClassifiedProps } from './reads/get-classified-props.js';
export { getComponentDescriptions } from './reads/get-component-descriptions.js';
export { getRawPropAllowedValues } from './reads/get-raw-prop-allowed-values.js';
export { getRawPropNameAtPosition } from './reads/get-raw-prop-name-at-position.js';
export { hasRawPropNamed } from './reads/has-raw-prop-named.js';

// Composer: reads every raw_* table for a session, fans the rows out through
// pure row → domain-object mappers, and joins them with indexRowsByKey. All
// mapping logic lives in core/; this function only owns the join.
export function getRawComponents(
  db: DatabaseSync,
  sessionId: string,
  allowedNames?: Set<string>,
): RawComponentWithId[] {
  const componentRows = getRawComponentRows(db, sessionId);
  const components = allowedNames ? componentRows.filter((c) => allowedNames.has(c.name)) : componentRows;
  if (components.length === 0) return [];

  const propRows = getRawPropRows(db, sessionId);
  const allowedValueRows = getRawPropAllowedValueRows(db, sessionId);
  const slotRows = getRawSlotRows(db, sessionId);
  const allowedComponentRows = getRawSlotAllowedComponentRows(db, sessionId);

  const propsByComponent = indexRowsByKey(propRows, (p) => p.component_id);
  const allowedValuesByProp = indexRowsByKey(allowedValueRows, (av) => `${av.component_id}::${av.prop_name}`);
  const slotsByComponent = indexRowsByKey(slotRows, (s) => s.component_id);
  const allowedComponentsBySlot = indexRowsByKey(allowedComponentRows, (ac) => `${ac.component_id}::${ac.slot_name}`);

  return components.map((c) => {
    const props = (propsByComponent.get(c.component_id) ?? []).map((p) =>
      mapRawPropToDefinition(p, allowedValuesByProp.get(`${c.component_id}::${p.name}`)),
    );
    const slots = (slotsByComponent.get(c.component_id) ?? []).map((s) =>
      mapRawSlotToDefinition(s, allowedComponentsBySlot.get(`${c.component_id}::${s.name}`)),
    );
    return mapRawComponentToWithId(c, props, slots);
  });
}

import type { RawSlotDefinition } from '../../../../types.js';
import type { RawSlotRow } from '../../../repositories/components/raw/interfaces/raw-slot-row.js';
import type { RawSlotAllowedComponentRow } from '../../../repositories/components/raw/interfaces/raw-slot-allowed-component-row.js';

// Pure row → domain-object mapper. Undefined-not-null semantics matching
// map-raw-prop-to-definition.
export function mapRawSlotToDefinition(
  row: RawSlotRow,
  allowedComponentRows: RawSlotAllowedComponentRow[] | undefined,
): RawSlotDefinition {
  const slot: RawSlotDefinition = {
    name: row.name,
    isDefault: Boolean(row.is_default),
  };
  if (row.description !== null) slot.description = row.description;
  if (allowedComponentRows && allowedComponentRows.length > 0) {
    slot.allowedComponents = allowedComponentRows.map((v) => v.allowed_component);
  }
  return slot;
}

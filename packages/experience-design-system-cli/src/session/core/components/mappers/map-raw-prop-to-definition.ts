import type { RawPropDefinition } from '../../../../types.js';
import type { RawPropRow } from '../../../repositories/components/raw/interfaces/raw-prop-row.js';
import type { AllowedValueSnapshotEntry } from '../snapshot-types.js';

// Pure row → domain-object mapper. Undefined-not-null semantics: a nullable
// column becomes an absent field on the domain object, not a null value.
export function mapRawPropToDefinition(
  row: RawPropRow,
  allowedValueRows: AllowedValueSnapshotEntry[] | undefined,
): RawPropDefinition {
  const prop: RawPropDefinition = {
    name: row.name,
    type: row.type,
    required: Boolean(row.required),
  };
  if (row.category !== null) prop.category = row.category as RawPropDefinition['category'];
  if (row.default_value !== null) prop.defaultValue = row.default_value;
  if (row.description !== null) prop.description = row.description;
  if (row.token_reference !== null) prop.tokenReference = row.token_reference;
  if (allowedValueRows && allowedValueRows.length > 0) {
    prop.allowedValues = allowedValueRows.map((v) => v.value);
  }
  if (row.source_start_line !== null) prop.sourceStartLine = row.source_start_line;
  if (row.source_end_line !== null) prop.sourceEndLine = row.source_end_line;
  return prop;
}

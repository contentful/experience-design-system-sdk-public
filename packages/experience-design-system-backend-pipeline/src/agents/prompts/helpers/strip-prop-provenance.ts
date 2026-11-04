import type { RawPropDefinition } from '../../../steps/extraction/src/types/component.js';

export function stripPropProvenance(prop: RawPropDefinition): Omit<RawPropDefinition, 'domAttribute'> {
  const { domAttribute: _domAttribute, ...authorableProp } = prop;
  return authorableProp;
}

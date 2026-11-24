import type { RawPropDefinition } from '../../../types/component.js';

export interface ExtractedInput {
  prop: RawPropDefinition;
  transform?: string;
}

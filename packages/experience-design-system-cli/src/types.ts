// Re-export all extraction types from the extraction package so existing
// internal imports (`from '../types.js'`) continue to work unchanged.
export type {
  ExtractionValidationIssue,
  RawPropDefinition,
  RawSlotDefinition,
  RawComponentDefinition,
} from '@contentful/experience-design-system-extraction';
export { stripScoringFields } from '@contentful/experience-design-system-extraction';

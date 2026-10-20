export {
  CDFPropertySchema,
  CDFSlotSchema,
  CDFComponentSchema,
  CDFTokenSchema,
} from '@contentful/experience-design-system-types';
export type {
  CDFPropertyDefinition,
  CDFFieldDefinition,
  CDFSlotDefinition,
  CDFComponentEntry,
  CDFTokenEntry,
  CDFValidationError,
  CDFValidationResult,
} from '@contentful/experience-design-system-types';
export interface CDFFile {
  $schema: string;
  [key: string]: unknown;
}

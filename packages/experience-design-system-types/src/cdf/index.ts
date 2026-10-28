export { validateCDF, parseCDFComponents } from './validate.js';
export { CDF_SCHEMA_URL, cdfJsonSchema } from './schema.js';
export { CDF_PROPERTY_TYPES, CDF_PROPERTY_CATEGORIES } from './vocabularies.js';
export {
  CDFComponentSchema,
  CDFPropertySchema,
  CDFSlotSchema,
  CDFTokenSchema,
  type CDFComponentEntry,
  type CDFFieldDefinition,
  type CDFPropertyDefinition,
  type CDFSlotDefinition,
  type CDFTokenEntry,
  type CDFValidationError,
  type CDFValidationResult,
} from './types.js';
export {
  buildCDF,
  buildFilteredCDF,
  stripUnsupportedSlotFields,
  validateSlotReferences,
  type CDFDocument,
} from './build.js';
export {
  finiteValuesIssue,
  isFinitePrimitiveType,
  isFinitePrimitiveValue,
  type FinitePrimitiveType,
  type FinitePrimitiveValue,
} from './finite-values.js';

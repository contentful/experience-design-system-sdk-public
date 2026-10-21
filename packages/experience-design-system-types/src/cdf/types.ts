import { Ajv } from 'ajv';
import { cdfJsonSchema } from './schema.js';
import * as z from 'zod/mini';
import { jsonValueIssue } from '../property-contract/json-value.js';
import type { RepresentationPlan, ModelBinding } from '../property-contract/representation-plan.js';
import { CDF_PROPERTY_TYPES, CDF_PROPERTY_CATEGORIES } from './vocabularies.js';
import { validateCDFProperty } from './property-validation.js';
import { DESIGN_TOKEN_TYPES } from '../dtcg/token-types.js';
import {
  SourceInputAssociationSchema,
  validateCDFSourceOwnerContract,
  type SourceInputAssociation,
} from '../source-input-association.js';

export interface CDFFieldDefinition {
  $type: (typeof CDF_PROPERTY_TYPES)[number];
  $category?: (typeof CDF_PROPERTY_CATEGORIES)[number];
  $description?: string;
  $required?: boolean;
  $default?: import('../property-contract/json-value.js').JsonValue;
  $values?: import('../property-contract/json-value.js').JsonValue[];
  $items?: CDFFieldDefinition;
  $fields?: Record<string, CDFFieldDefinition>;
  '$token.kind'?: string;
  '$token.allowed'?: string[];
}
export interface CDFPropertyDefinition extends CDFFieldDefinition {
  $category: (typeof CDF_PROPERTY_CATEGORIES)[number];
  $sourceInput?: SourceInputAssociation;
}
export const CDFPropertySchema = z.custom<CDFPropertyDefinition>((value) => validateCDFProperty(value).valid);

const ModelBindingSchema = z.strictObject({
  planId: z.string(),
  componentId: z.string(),
  propertyId: z.string(),
  nodeId: z.string(),
});
const ModelCardinalitySchema = z
  .strictObject({
    min: z.number().check(z.int(), z.minimum(0)),
    max: z.nullable(z.number().check(z.int(), z.minimum(0))),
    ordered: z.boolean(),
    tuplePosition: z.optional(z.number().check(z.int(), z.minimum(0))),
    rest: z.optional(z.boolean()),
  })
  .check(z.refine((value) => value.max === null || value.max >= value.min));
export const CDFSlotSchema = z.strictObject({
  $modelBinding: z.optional(ModelBindingSchema),
  $cardinality: z.optional(ModelCardinalitySchema),
  $sourceInput: z.optional(SourceInputAssociationSchema),
  $description: z.optional(z.string()),
  $allowedComponents: z.optional(z.array(z.string())),
  $required: z.optional(z.boolean()),
});

export type CDFSlotDefinition = z.infer<typeof CDFSlotSchema>;

export interface CDFComponentEntry {
  $type: 'component';
  $description?: string;
  $properties: Record<string, CDFPropertyDefinition>;
  $slots?: Record<string, CDFSlotDefinition>;
  $model?: ModelBinding;
  $representationPlans?: Record<string, RepresentationPlan>;
}
const admitComponent = new Ajv({ allErrors: true }).compile({
  $ref: '#/definitions/component',
  definitions: cdfJsonSchema.definitions,
});

/** Custom admission keeps own dictionary keys intact instead of rebuilding a record. */
export const CDFComponentSchema = z.custom<CDFComponentEntry>((value) => {
  if (jsonValueIssue(value) || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!admitComponent(value)) return false;
  const entry = value as CDFComponentEntry;
  if (
    entry.$type !== 'component' ||
    !entry.$properties ||
    typeof entry.$properties !== 'object' ||
    Array.isArray(entry.$properties)
  )
    return false;
  if (
    Object.keys(entry).some(
      (key) => !['$type', '$description', '$properties', '$slots', '$model', '$representationPlans'].includes(key),
    )
  )
    return false;
  if (entry.$description !== undefined && typeof entry.$description !== 'string') return false;
  if (Object.values(entry.$properties).some((property) => !validateCDFProperty(property).valid)) return false;
  if (
    entry.$slots !== undefined &&
    (!entry.$slots ||
      typeof entry.$slots !== 'object' ||
      Array.isArray(entry.$slots) ||
      Object.entries(entry.$slots).some(([key, slot]) => !key.trim() || !CDFSlotSchema.safeParse(slot).success))
  )
    return false;
  if (entry.$model !== undefined && !ModelBindingSchema.safeParse(entry.$model).success) return false;
  if (
    entry.$representationPlans !== undefined &&
    (!entry.$representationPlans ||
      typeof entry.$representationPlans !== 'object' ||
      Array.isArray(entry.$representationPlans) ||
      Object.entries(entry.$representationPlans).some(
        ([key, plan]) =>
          !plan ||
          plan.identity?.key !== key ||
          plan.schemaVersion !== 1 ||
          typeof plan.id !== 'string' ||
          !Array.isArray(plan.models) ||
          !Array.isArray(plan.mappings),
      ))
  )
    return false;
  try {
    validateCDFSourceOwnerContract(entry);
    return true;
  } catch {
    return false;
  }
});

export interface CDFFile {
  $schema: string;
  [key: string]: unknown;
}

export interface CDFValidationError {
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

/** A token leaf — same shape as a DTCG token entry, but discovered inside
 * the CDF tree rather than a standalone DTCG document. */
export const CDFTokenSchema = z.strictObject({
  $type: z.enum(DESIGN_TOKEN_TYPES),
  $value: z.unknown(),
  $description: z.optional(z.string()),
});

export type CDFTokenEntry = z.infer<typeof CDFTokenSchema>;

export interface CDFValidationResult {
  valid: boolean;
  errors: CDFValidationError[];
  components: Array<{ key: string; entry: CDFComponentEntry }>;
  tokens: Array<{ path: string; entry: CDFTokenEntry }>;
}

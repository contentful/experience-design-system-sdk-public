import * as z from 'zod/mini';
import { CDF_PROPERTY_TYPES, CDF_PROPERTY_CATEGORIES } from './vocabularies.js';
import { DESIGN_TOKEN_TYPES } from '../dtcg/token-types.js';

export const CDFPropertySchema = z.strictObject({
  $type: z.enum(CDF_PROPERTY_TYPES),
  $category: z.enum(CDF_PROPERTY_CATEGORIES),
  $description: z.optional(z.string()),
  $required: z.optional(z.boolean()),
  $default: z.optional(z.any()),
  $values: z.optional(z.array(z.string())),
  '$token.kind': z.optional(z.string()),
  '$token.allowed': z.optional(z.array(z.string())),
});

export type CDFPropertyDefinition = z.infer<typeof CDFPropertySchema>;

export const CDFSlotSchema = z.strictObject({
  $description: z.optional(z.string()),
  $allowedComponents: z.optional(z.array(z.string())),
  $required: z.optional(z.boolean()),
});

export type CDFSlotDefinition = z.infer<typeof CDFSlotSchema>;

export const CDFComponentSchema = z.strictObject({
  $type: z.literal('component'),
  $description: z.optional(z.string()),
  $properties: z.record(z.string(), CDFPropertySchema),
  $slots: z.optional(z.record(z.string(), CDFSlotSchema)),
});

export type CDFComponentEntry = z.infer<typeof CDFComponentSchema>;

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

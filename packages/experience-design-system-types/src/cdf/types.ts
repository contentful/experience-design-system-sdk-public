import * as z from 'zod/mini';
import { CDF_PROPERTY_TYPES, CDF_PROPERTY_CATEGORIES } from './vocabularies.js';

export const CDFPropertyDefinitionSchema = z.strictObject({
  $type: z.enum(CDF_PROPERTY_TYPES),
  $category: z.enum(CDF_PROPERTY_CATEGORIES),
  $description: z.optional(z.string()),
  $required: z.optional(z.boolean()),
  $default: z.optional(z.any()),
  $values: z.optional(z.array(z.string())),
  '$token.kind': z.optional(z.string()),
});

export type CDFPropertyDefinition = z.infer<typeof CDFPropertyDefinitionSchema>;

export const CDFSlotDefinitionSchema = z.strictObject({
  $description: z.optional(z.string()),
  $allowedComponents: z.optional(z.array(z.string())),
  $required: z.optional(z.boolean()),
});

export type CDFSlotDefinition = z.infer<typeof CDFSlotDefinitionSchema>;

export const CDFComponentEntrySchema = z.strictObject({
  $type: z.literal('component'),
  $description: z.optional(z.string()),
  $properties: z.record(z.string(), CDFPropertyDefinitionSchema),
  $slots: z.optional(z.record(z.string(), CDFSlotDefinitionSchema)),
});

export type CDFComponentEntry = z.infer<typeof CDFComponentEntrySchema>;

export type CDFGroupOrComponent = CDFComponentEntry | CDFGroup;

export interface CDFGroup {
  $description?: string;
  [key: string]: CDFGroupOrComponent | string | undefined;
}

export interface CDFFile {
  $schema: string;
  [key: string]: CDFGroupOrComponent | string | undefined;
}

export interface CDFValidationError {
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface CDFValidationResult {
  valid: boolean;
  errors: CDFValidationError[];
  components: Array<{ key: string; entry: CDFComponentEntry }>;
}

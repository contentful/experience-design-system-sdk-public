import { Ajv } from 'ajv';
import { cdfJsonSchema } from './schema.js';
import * as z from 'zod/mini';
import { childPath, jsonValueIssue, type PropertyIssue } from '../property-contract/json-value.js';
import { schemaValidationErrors } from './schema-errors.js';
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
  value?: import('../property-contract/json-value.js').JsonValue;
  valueType?: CDFFieldDefinition;
  discriminator?: string;
  members?: CDFFieldDefinition[];
  allowedResources?: import('../property-contract/target-definition.js').TargetDefinition['allowedResources'];
  '$token.kind'?: string;
  '$token.allowed'?: string[];
}
export interface CDFPropertyDefinition extends CDFFieldDefinition {
  $category: (typeof CDF_PROPERTY_CATEGORIES)[number];
  $sourceInput?: SourceInputAssociation;
}
function pointerPath(value: unknown, pointer: string): PropertyKey[] {
  if (!pointer) return [];
  let current = value;
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => {
      const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
      const index = Array.isArray(current) && /^(0|[1-9]\d*)$/.test(key) ? Number(key) : undefined;
      current =
        current && typeof current === 'object' && Object.hasOwn(current, key)
          ? (current as Record<string, unknown>)[key]
          : undefined;
      return index ?? key;
    });
}

function issueSchema<T>(issues: (value: unknown) => PropertyIssue[]) {
  return z.custom<T>().check(
    z.superRefine((value, ctx) => {
      for (const issue of issues(value))
        ctx.addIssue({ code: 'custom', input: value, path: pointerPath(value, issue.path), message: issue.message });
    }),
  );
}

export const CDFPropertySchema = issueSchema<CDFPropertyDefinition>((value) => validateCDFProperty(value).issues);

const ModelBindingSchema = z.strictObject({
  planId: z.string(),
  componentId: z.string(),
  propertyId: z.string(),
  nodeId: z.string(),
  sourceNodeId: z.optional(z.string()),
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

function zodIssues(path: string, issues: readonly { path: PropertyKey[]; message: string }[]): PropertyIssue[] {
  return issues.map((issue) => ({
    path: issue.path.reduce<string>((parent, key) => childPath(parent, String(key)), path),
    message: issue.message,
  }));
}

function slotIssues(slots: Record<string, unknown>): PropertyIssue[] {
  return Object.entries(slots).flatMap(([key, slot]) => {
    const path = childPath('/$slots', key);
    if (!key.trim()) return [{ path, message: 'Slot id must be a non-empty string' }];
    return zodIssues(path, CDFSlotSchema.safeParse(slot).error?.issues ?? []);
  });
}

function representationPlanIssues(plans: Record<string, Partial<RepresentationPlan> | null>): PropertyIssue[] {
  return Object.entries(plans).flatMap(([key, plan]) => {
    const path = childPath('/$representationPlans', key);
    if (
      !plan ||
      plan.schemaVersion !== 1 ||
      typeof plan.id !== 'string' ||
      !Array.isArray(plan.models) ||
      !Array.isArray(plan.mappings)
    )
      return [{ path, message: 'Expected complete representation plan' }];
    return plan.identity?.key === key ? [] : [{ path, message: 'Representation plan identity must match its key' }];
  });
}

export function componentEntryIssues(value: unknown): PropertyIssue[] {
  const unsafe = jsonValueIssue(value);
  if (unsafe) return [unsafe];
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return [{ path: '', message: 'Expected component object' }];
  if (!admitComponent(value))
    return schemaValidationErrors(admitComponent.errors).map(({ path, message }) => ({
      path: path === '/' ? '' : path,
      message,
    }));
  const entry = value as CDFComponentEntry;
  const issues = [
    ...Object.entries(entry.$properties).flatMap(([key, property]) =>
      validateCDFProperty(property).issues.map((issue) => ({
        path: childPath('/$properties', key) + issue.path,
        message: issue.message,
      })),
    ),
    ...slotIssues(entry.$slots ?? {}),
    ...(entry.$model === undefined
      ? []
      : zodIssues('/$model', ModelBindingSchema.safeParse(entry.$model).error?.issues ?? [])),
    ...representationPlanIssues(entry.$representationPlans ?? {}),
  ];
  if (issues.length) return issues;
  try {
    validateCDFSourceOwnerContract(entry);
    return [];
  } catch (error) {
    return [{ path: '', message: error instanceof Error ? error.message : 'Invalid source input ownership' }];
  }
}

export const CDFComponentSchema = issueSchema<CDFComponentEntry>(componentEntryIssues);

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

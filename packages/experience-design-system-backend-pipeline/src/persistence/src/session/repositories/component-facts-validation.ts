import { z } from 'zod';
import { jsonValueIssue } from '@contentful/experience-design-system-types';
import {
  COMPONENT_FACT_SCHEMA_VERSION,
  type ComponentFacts,
  type ComponentEvidenceReadStatus,
} from '@contentful/experience-design-system-extraction';

const location = z
  .object({
    fileId: z.string().nullable(),
    canonicalPath: z.string().nullable(),
    textHash: z.string().nullable(),
    startLine: z.number().int().positive().nullable(),
    endLine: z.number().int().positive().nullable(),
    startOffset: z.number().int().nonnegative().nullable().optional(),
    endOffset: z.number().int().nonnegative().nullable().optional(),
    binding: z.enum(['verified', 'changed', 'unverified', 'unavailable']),
  })
  .strict()
  .refine(
    (value) =>
      (value.startLine === null || value.endLine === null || value.endLine >= value.startLine) &&
      (value.startOffset == null || value.endOffset == null || value.endOffset >= value.startOffset),
  );
const observation = z.object({
  certainty: z.enum(['certain', 'ambiguous', 'unknown']),
  location: location.nullable(),
  sourceTypeText: z.string().optional(),
});
const origin = observation
  .extend({
    kind: z.enum(['in-folder', 'in-repository', 'external-package', 'unresolved']),
    realPath: z.string().optional(),
    packageName: z.string().optional(),
  })
  .strict();
const facts = z
  .object({
    schemaVersion: z.literal(COMPONENT_FACT_SCHEMA_VERSION),
    renderables: z
      .array(
        observation
          .extend({
            name: z.string(),
            delivery: z.enum(['node-prop', 'named-slot', 'scoped-slot', 'render-function']),
            usage: z.enum(['cloned', 'props-read', 'element-check', 'placed']).optional(),
            elementTyped: z.boolean().nullable().optional(),
            typeName: z.string().optional(),
            origin: z.enum(['own', 'imported', 'inherited-dom', 'inherited-library', 'mixed', 'unknown']).optional(),
          })
          .strict(),
      )
      .optional(),
    members: z.array(observation.extend({ name: z.string(), exportName: z.string().optional() }).strict()).optional(),
    childFilters: z
      .array(
        observation
          .extend({
            slot: z.string(),
            kind: z.enum(['type-check', 'display-name', 'vnode-name', 'jsdoc-slot']),
            allowed: z.array(z.string()),
          })
          .strict(),
      )
      .optional(),
    requiresParent: z
      .array(
        observation
          .extend({ parent: z.string(), reason: z.enum(['context-throws', 'context-missing', 'inject-no-default']) })
          .strict(),
      )
      .optional(),
    nonStatic: z
      .array(
        observation
          .extend({
            kind: z.enum(['callback', 'controlled-pair', 'ref', 'external-call', 'context-read', 'portal']),
            name: z.string().optional(),
            hasDefault: z.boolean().optional(),
            throwsWithoutProvider: z.boolean().optional(),
            provider: z.enum(['component', 'host-application', 'unknown']).optional(),
            declaredIn: z.string().optional(),
            packageName: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    origin: origin.optional(),
    referencedOrigins: z
      .array(observation.extend({ name: z.string(), symbolName: z.string().optional(), origin }).strict())
      .optional(),
  })
  .strict();

export type ComponentFactsRead = { status: ComponentEvidenceReadStatus; facts?: ComponentFacts };
/** Validate independently from candidate evidence; never serialize compiler objects or unknown fields. */
export function readComponentFacts(value: unknown): ComponentFactsRead {
  if (value === undefined) return { status: 'unknown-legacy' };
  if (jsonValueIssue(value)) return { status: 'corrupt' };
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'schemaVersion' in value &&
    typeof value.schemaVersion === 'number' &&
    value.schemaVersion !== COMPONENT_FACT_SCHEMA_VERSION
  )
    return { status: 'unsupported' };
  const validated = facts.safeParse(value);
  return validated.success ? { status: 'available', facts: validated.data } : { status: 'corrupt' };
}

export function readComponentFactsJson(payload: string | null): ComponentFactsRead {
  if (payload === null) return readComponentFacts(undefined);
  try {
    return readComponentFacts(JSON.parse(payload) as unknown);
  } catch {
    return { status: 'corrupt' };
  }
}

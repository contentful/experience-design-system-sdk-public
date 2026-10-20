import { z } from 'zod';
import type {
  ExtractionDiagnostics,
  SourceCandidate,
  SourceCandidateSource,
} from '@contentful/experience-design-system-extraction';

const origin = z.enum(['own', 'imported', 'inherited-dom', 'inherited-library', 'mixed', 'unknown']);
const evidenceKind = z.enum(['declaration', 'runtime-object', 'implementation', 'binding']);
const location = z.object({
  fileId: z.string().nullable(),
  canonicalPath: z.string().nullable(),
  textHash: z.string().nullable(),
  startLine: z.number().int().positive().nullable(),
  endLine: z.number().int().positive().nullable(),
  startOffset: z.number().int().nonnegative().nullable().optional(),
  endOffset: z.number().int().nonnegative().nullable().optional(),
  binding: z.enum(['verified', 'changed', 'unverified', 'unavailable']),
});
const fact = z.object({
  origin,
  resolvedKind: z.string(),
  certainty: z.enum(['certain', 'ambiguous', 'unknown']),
  ambiguityReason: z.string().nullable(),
  declarations: z.array(location),
  sourceTypeText: z.string(),
  domain: z.object({
    observedLiterals: z.array(z.object({ kind: z.enum(['string', 'number', 'boolean', 'null']), value: z.string() })),
    openness: z.enum(['closed', 'open', 'unknown']),
  }),
  declaredRequired: z.boolean().nullable(),
  sourceDefault: z.object({ expression: z.string(), location: location.nullable() }).nullable(),
  advisoryShape: z.null(),
  shapeNotes: z.array(z.string()),
  requiredFieldDropped: z.boolean().nullable(),
});
const webComponentSyntax = z.object({
  reader: z.literal('web-component'),
  lineage: z.enum(['own', 'base', 'mixin']),
  declaringClass: z.string().nullable(),
  converter: z.object({ state: z.enum(['known', 'absent', 'unknown']), expression: z.string().nullable() }),
  attribute: z.object({
    state: z.enum(['explicit', 'implicit', 'disabled', 'absent', 'unknown']),
    name: z.string().nullable(),
  }),
  reflect: z.object({ state: z.enum(['explicit', 'absent', 'unknown']), value: z.boolean().nullable() }),
  exposure: z.array(z.string()),
  default: z.object({
    expression: z.string().nullable(),
    state: z.enum(['literal', 'resolved', 'absent', 'unresolved']),
    value: z.object({ kind: z.enum(['string', 'number', 'boolean', 'null']), value: z.string() }).nullable(),
    reason: z.string().nullable(),
    locations: z.array(location),
  }),
  typeLocations: z.array(location),
  slotKind: z.enum(['jsdoc', 'literal-template']).nullable(),
});
const syntax = z.discriminatedUnion('reader', [
  webComponentSyntax,
  z.object({
    reader: z.literal('vue'),
    channel: z.enum(['prop', 'slot-contract', 'slot-template', 'slot-access']),
    occurrence: z.number().int().nonnegative(),
    resolution: z.enum(['resolved', 'partial', 'unresolved']),
    resolutionReason: z.string().nullable(),
    expression: z.string(),
    spreadPath: z.array(z.string()),
    conditions: z.array(z.string()),
    loops: z.array(z.string()),
    fallback: z.string().nullable(),
    default: webComponentSyntax.shape.default,
    typeLocations: z.array(location),
  }),
]);
const candidate = z.object({
  name: z.string(),
  keyPath: z.array(z.string()),
  evidenceKinds: z.array(evidenceKind),
  type: z.string(),
  declaredRequired: z.boolean().nullable(),
  sourceDefault: z.string().nullable(),
  facts: fact.nullable(),
  observations: z.array(
    z.object({
      name: z.string(),
      keyPath: z.array(z.string()),
      evidenceKind,
      type: z.string(),
      declaredRequired: z.boolean().nullable(),
      sourceDefault: z.string().nullable(),
      origin,
      location: location.nullable(),
      fact: fact.optional(),
      syntax: syntax.optional(),
    }),
  ),
  projection: z.object({ kind: z.enum(['prop', 'slot', 'excluded', 'unknown']), reason: z.string().nullable() }),
}) satisfies z.ZodType<SourceCandidate>;

const alternateSource = z.object({
  componentName: z.string(),
  sourcePath: z.string(),
  factSchemaVersion: z.number().int().nullable(),
  candidates: z.array(candidate).nullable(),
}) satisfies z.ZodType<SourceCandidateSource>;

const diagnostics = z.object({
  schemaVersion: z.literal(1),
  projects: z.array(
    z.object({
      root: z.string(),
      configPath: z.string().nullable(),
      configHash: z.string().nullable(),
      status: z.enum(['configured', 'fallback', 'invalid', 'ambiguous']),
      options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
      diagnostics: z.array(z.string()),
    }),
  ),
  modules: z.array(
    z.object({
      specifier: z.string(),
      fromPath: z.string(),
      outcome: z.enum(['resolved', 'unresolved', 'external', 'unavailable']),
      reason: z.string().nullable(),
    }),
  ),
  references: z.array(
    z.object({
      root: z.string(),
      configPath: z.string().nullable(),
      outcome: z.enum(['selected', 'fallback', 'missing', 'invalid', 'ambiguous', 'cycle', 'budget-exhausted']),
    }),
  ),
  coverage: z.enum(['complete-within-declared-bound', 'partial', 'unavailable']),
  limits: z.record(z.string(), z.number()),
  used: z.record(z.string(), z.number()),
}) satisfies z.ZodType<ExtractionDiagnostics>;

/** Validate saved evidence before exposing it to prompt and review consumers. */
export function isSourceCandidatePayload(value: unknown): value is SourceCandidate[] {
  return z.array(candidate).safeParse(value).success;
}

export function isAlternateSourcePayload(value: unknown): value is SourceCandidateSource[] {
  return z.array(alternateSource).safeParse(value).success;
}

export function isExtractionDiagnosticsPayload(value: unknown): value is ExtractionDiagnostics {
  return diagnostics.safeParse(value).success;
}

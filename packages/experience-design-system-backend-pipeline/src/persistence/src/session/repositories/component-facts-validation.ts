import { z } from 'zod';
import { jsonValueIssue } from '@contentful/experience-design-system-types';
import {
  readInputOutput,
  readSourceReferences,
  type SourceReferenceIndex,
  type SourceInputOutputEvidence,
  COMPONENT_FACT_SCHEMA_VERSION,
  readSourceClosure,
  sourceClosureMatchesObservations,
  type SourceClosureEvidence,
  type ComponentFacts,
  type ComponentEvidenceReadStatus,
} from '../../../../steps/extraction/index.js';

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
const certainty = z.enum(['certain', 'ambiguous', 'unknown']);
const limits = z
  .object({
    maxNodes: z.number().int().nonnegative(),
    maxDepth: z.number().int().nonnegative(),
    maxReferences: z.number().int().nonnegative(),
    maxDeclarations: z.number().int().nonnegative(),
    maxSignatures: z.number().int().nonnegative(),
    maxObservations: z.number().int().nonnegative(),
    maxManifestReads: z.number().int().nonnegative(),
  })
  .strict();
const declarationOrigin = z
  .object({
    realPath: z.string().nullable(),
    realpathStatus: z.enum(['resolved', 'unavailable']),
    selected: z.enum(['inside', 'outside', 'unknown']),
    repository: z.enum(['inside', 'outside', 'unknown']),
    packageStatus: z.enum(['resolved', 'absent', 'unavailable']),
    package: z
      .object({
        name: z.string(),
        private: z.boolean().nullable(),
        publication: z.literal('unknown'),
        manifest: location,
      })
      .strict()
      .nullable(),
  })
  .strict();
const symbol = z
  .object({
    id: z.string().nullable(),
    name: z.string(),
    resolution: z.enum(['resolved', 'ambiguous', 'unresolved']),
    defaultLibrary: z.boolean().nullable(),
    aliases: z.array(z.object({ name: z.string(), location }).strict()),
    declarations: z.array(z.object({ id: z.string(), kind: z.string(), location, origin: declarationOrigin }).strict()),
  })
  .strict();
const inputPath = z
  .object({
    rootSymbolId: z.string(),
    rootDeclaration: location,
    parameterIndex: z.number().int().nonnegative(),
    segments: z.array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('field'), name: z.string() }).strict(),
        z.object({ kind: z.literal('index'), value: z.string() }).strict(),
        z.object({ kind: z.literal('computed'), expression: z.string() }).strict(),
        z.object({ kind: z.literal('rest') }).strict(),
      ]),
    ),
    certainty,
    reason: z.string().nullable(),
  })
  .strict();
const operand = z
  .object({
    role: z.enum(['callee', 'argument', 'target', 'value', 'left', 'right', 'owner', 'condition']),
    index: z.number().int().nonnegative().nullable(),
    expression: z.string(),
    location,
    symbol: symbol.nullable(),
    inputPath: inputPath.nullable(),
  })
  .strict();
const callableSignature = z
  .object({
    declaration: location.nullable(),
    parameters: z.array(
      z
        .object({
          name: z.string(),
          typeText: z.string(),
          required: z.boolean().nullable(),
          location: location.nullable(),
        })
        .strict(),
    ),
    returnTypeText: z.string(),
  })
  .strict();
const condition = z
  .object({
    expression: z.string(),
    branch: z.enum(['then', 'else', 'truthy', 'falsy', 'body', 'case', 'nullish']),
    location,
  })
  .strict();
const conditionalFieldClaim = z
  .object({
    status: z.enum(['conditional', 'unknown']),
    premises: z.array(z.string()),
    reasons: z.array(z.string()),
  })
  .strict();
const fieldSemantics = z
  .object({
    schemaVersion: z.literal(1),
    semantics: z.literal('conditional-ordered-field-flow'),
    componentDeclarationId: z.string(),
    source: location,
    coverage: z.enum(['complete-within-declared-bound', 'partial', 'unavailable']),
    proofs: z.array(
      z
        .object({
          inputName: z.string(),
          path: z.array(
            z
              .object({
                kind: z.enum(['field', 'item', 'tuple', 'union', 'intersection', 'index']),
                key: z.union([z.string(), z.number()]),
              })
              .strict(),
          ),
          valueIndependence: conditionalFieldClaim,
          omissionSafety: conditionalFieldClaim,
          outputDependence: z.enum(['possible', 'not-observed', 'unknown']),
        })
        .strict(),
    ),
    steps: z.array(
      z
        .object({
          operation: z.enum(['binding', 'spread', 'write', 'read', 'call', 'return', 'branch']),
          frame: z.number().int().nonnegative(),
          location,
          conditions: z.array(condition),
        })
        .strict(),
    ),
    omissions: z.array(z.object({ reason: z.string(), location }).strict()),
    used: z.object({ nodes: z.number().int().nonnegative(), maxDepth: z.number().int().nonnegative() }).strict(),
  })
  .strict();
const sourceObservations = z
  .object({
    fieldSemantics: fieldSemantics.optional(),
    referenceIndex: z
      .custom<SourceReferenceIndex>((value) => readSourceReferences(value).status === 'available')
      .optional(),
    inputOutput: z
      .custom<SourceInputOutputEvidence>((value) => readInputOutput(value).status === 'available')
      .optional(),
    schemaVersion: z.literal(1),
    componentDeclarationId: z.string(),
    selectedSourcePaths: z.array(z.string()),
    repositoryRoot: z.string().nullable(),
    observations: z.array(
      z
        .object({
          id: z.string(),
          kind: z.enum([
            'declaration',
            'binding',
            'call',
            'return',
            'assignment',
            'comparison',
            'condition',
            'member-read',
            'annotation',
            'throw',
            'assertion',
            'jsx',
            'jsx-attribute',
            'spread',
          ]),
          expression: z.string(),
          location,
          certainty,
          context: z
            .object({
              lexicalDeclaration: location.nullable(),
              execution: z.enum(['component-body', 'deferred', 'referenced-body', 'source-file']),
              conditions: z.array(condition),
            })
            .strict(),
          subject: symbol.nullable(),
          inputPath: inputPath.nullable().optional(),
          candidateKeyPath: z.array(z.string()).optional(),
          type: z
            .object({
              typeText: z.string(),
              signatures: z.array(callableSignature),
              resolvedSignature: callableSignature.nullable().optional(),
              resultTypeText: z.string().optional(),
            })
            .strict()
            .optional(),
          operands: z.array(operand).optional(),
          destination: z
            .object({ kind: z.enum(['reference', 'markup-attribute']), name: z.string() })
            .strict()
            .optional(),
          operator: z.string().optional(),
          initializer: z.string().nullable().optional(),
          resultUse: z
            .object({
              kind: z.enum([
                'discarded',
                'returned',
                'argument',
                'initializer',
                'member',
                'condition',
                'assigned',
                'expression',
              ]),
              parentKind: z.string(),
              location,
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
    coverage: z.enum(['complete-within-declared-bound', 'partial', 'unavailable']),
    limits,
    used: limits,
    omissions: z.array(
      z.object({ reason: z.string(), location: location.nullable(), count: z.number().int().positive() }).strict(),
    ),
  })
  .strict()
  .refine(
    (value) =>
      Object.entries(value.used).every(([key, used]) => used <= value.limits[key as keyof typeof value.limits]) &&
      value.observations.length <= value.used.maxObservations,
  );

const legacyFacts = z
  .object({
    schemaVersion: z.literal(1),
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

const facts = z.union([
  legacyFacts,
  legacyFacts
    .extend({
      schemaVersion: z.literal(COMPONENT_FACT_SCHEMA_VERSION),
      sourceObservations: sourceObservations.optional(),
      sourceClosure: z
        .custom<SourceClosureEvidence>((value) => readSourceClosure(value).status === 'available')
        .optional(),
    })
    .strict(),
]);

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
    value.schemaVersion !== 1 &&
    value.schemaVersion !== COMPONENT_FACT_SCHEMA_VERSION
  )
    return { status: 'unsupported' };
  if (value && typeof value === 'object' && !Array.isArray(value) && 'sourceObservations' in value) {
    const collection = value.sourceObservations;
    if (
      collection &&
      typeof collection === 'object' &&
      'referenceIndex' in collection &&
      readSourceReferences(collection.referenceIndex).status === 'unsupported'
    )
      return { status: 'unsupported' };
    if (
      collection &&
      typeof collection === 'object' &&
      'inputOutput' in collection &&
      readInputOutput(collection.inputOutput).status === 'unsupported'
    )
      return { status: 'unsupported' };
    if (
      collection &&
      typeof collection === 'object' &&
      !Array.isArray(collection) &&
      'schemaVersion' in collection &&
      typeof collection.schemaVersion === 'number' &&
      collection.schemaVersion !== 1
    )
      return { status: 'unsupported' };
  }
  if (
    value &&
    typeof value === 'object' &&
    'sourceClosure' in value &&
    readSourceClosure(value.sourceClosure).status === 'unsupported'
  )
    return { status: 'unsupported' };
  const validated = facts.safeParse(value);
  if (
    validated.success &&
    validated.data.schemaVersion === COMPONENT_FACT_SCHEMA_VERSION &&
    validated.data.sourceObservations?.fieldSemantics &&
    validated.data.sourceObservations.fieldSemantics.componentDeclarationId !==
      validated.data.sourceObservations.componentDeclarationId
  )
    return { status: 'corrupt' };
  if (
    validated.success &&
    validated.data.schemaVersion === COMPONENT_FACT_SCHEMA_VERSION &&
    validated.data.sourceObservations?.referenceIndex &&
    validated.data.sourceObservations.referenceIndex.componentDeclarationId !==
      validated.data.sourceObservations.componentDeclarationId
  )
    return { status: 'corrupt' };
  if (
    validated.success &&
    validated.data.schemaVersion === COMPONENT_FACT_SCHEMA_VERSION &&
    validated.data.sourceObservations?.inputOutput &&
    validated.data.sourceObservations.inputOutput.componentDeclarationId !==
      validated.data.sourceObservations.componentDeclarationId
  )
    return { status: 'corrupt' };
  if (validated.success && validated.data.schemaVersion === COMPONENT_FACT_SCHEMA_VERSION) {
    const observations = validated.data.sourceObservations;
    const roots = observations?.observations.flatMap((observation) =>
      observation.kind === 'binding' && observation.inputPath?.segments.length === 0 ? [observation.inputPath] : [],
    );
    if (
      roots?.length &&
      observations?.inputOutput?.inputs.some(
        (input) =>
          !roots.some(
            (root) => root.rootSymbolId === input.rootSymbolId && root.parameterIndex === input.parameterIndex,
          ),
      )
    )
      return { status: 'corrupt' };
  }
  if (
    validated.success &&
    validated.data.schemaVersion === COMPONENT_FACT_SCHEMA_VERSION &&
    validated.data.sourceClosure &&
    (!validated.data.sourceObservations ||
      !sourceClosureMatchesObservations(validated.data.sourceClosure, validated.data.sourceObservations))
  )
    return { status: 'corrupt' };
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

import { z } from 'zod';
import { EXPLORE_SCOPES } from './constants.js';
import { SourceInputAssociationSchema } from '../source-input-association.js';
import { finiteValuesIssue } from '../cdf/finite-values.js';
import { jsonValueIssue, jsonEqual, own, type JsonValue } from '../property-contract/json-value.js';
import { validateCDFProperty, containsCDFDefinitionType, cdfToTarget } from '../cdf/property-validation.js';
import { validateTargetValue } from '../property-contract/target-definition.js';
import type { CDFPropertyDefinition } from '../cdf/types.js';
import {
  validateProposalDraft,
  type RepresentationProposalDraft,
} from '../property-contract/representation-proposal.js';
export const VerifyEvidenceSchema = z.object({
  source: z.string().min(1),
  line: z.string().min(1),
  quote: z.string().min(1),
});
export const SlotRestrictionSchema = z.object({
  kind: z.enum(['declared', 'enforced']),
  applicable: z.boolean(),
  evidence: z.array(VerifyEvidenceSchema).min(1),
});
export const ExplorePropReportSchema = z
  .object({
    name: z.string().min(1),
    category: z.enum(['content', 'design', 'state', 'unattached']).optional(),
    type: z.string().optional(),
    definition: z.custom<CDFPropertyDefinition>((value) => validateCDFProperty(value).valid).optional(),
    values: z
      .array(z.union([z.string(), z.number(), z.boolean()]))
      .nonempty()
      .optional(),
    observedValues: z.array(z.custom<JsonValue>((value) => !jsonValueIssue(value))).optional(),
    tokenKind: z.string().optional(),
    tokenPaths: z.array(z.string()).optional(),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
    description: z.string().optional(),
    reasoning: z.string().optional(),
    representationProposal: z
      .custom<RepresentationProposalDraft>((value) => validateProposalDraft(value).length === 0)
      .optional(),
  })
  .superRefine((report, ctx) => {
    if (report.type === 'DiscriminatedUnion' || report.definition !== undefined) {
      const definition = report.definition;
      if (
        !definition ||
        !validateCDFProperty(definition).valid ||
        !containsCDFDefinitionType(definition, 'DiscriminatedUnion') ||
        definition.$type !== report.type ||
        definition.$category !== report.category ||
        report.category !== 'content' ||
        ['values', 'tokenKind', 'tokenPaths', 'representationProposal'].some((key) => own(report, key)) ||
        (own(report, 'required') && report.required !== (definition.$required ?? false)) ||
        (own(report, 'description') && report.description !== definition.$description) ||
        (own(report, 'default') &&
          (validateTargetValue(cdfToTarget(definition), report.default as JsonValue).length ||
            (own(definition, '$default') && !jsonEqual(report.default, definition.$default))))
      )
        ctx.addIssue({
          code: 'custom',
          path: ['definition'],
          message: 'Union decisions require one complete consistent content definition',
        });
    }
    if (report.type === 'enum')
      ctx.addIssue({ code: 'custom', path: ['type'], message: 'Use a primitive type with typed values' });
    if (report.values !== undefined) {
      const issue = finiteValuesIssue(report.type, report.values);
      if (issue)
        ctx.addIssue({
          code: 'custom',
          path: issue.index === undefined ? ['values'] : ['values', issue.index],
          message: issue.message,
        });
    }
  });
export const ExploreSlotEvidenceSchema = z.object({
  name: z.string().refine((value) => value.trim().length > 0),
  sourceInput: z
    .custom<
      import('../source-input-association.js').SourceInputAssociation
    >((value) => SourceInputAssociationSchema.safeParse(value).success)
    .optional(),
  isRealSlot: z.boolean(),
  allowedComponents: z.array(z.string().min(1)).optional(),
  evidence: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  reasoning: z.string().optional(),
  restriction: SlotRestrictionSchema.optional(),
});
export const ExploreCompanionSchema = z.object({
  agentRole: z.enum(EXPLORE_SCOPES),
  components: z.array(
    z.object({
      name: z.string().min(1),
      source: z.string().min(1),
      componentId: z.string().optional(),
      included: z.boolean().optional(),
      inclusionReasoning: z.string().optional(),
      modelingNotes: z.array(z.string()).optional(),
      props: z.array(ExplorePropReportSchema).optional(),
      slots: z.array(ExploreSlotEvidenceSchema).optional(),
    }),
  ),
  rawTokenReferences: z
    .array(
      z.object({ tokenPath: z.string(), file: z.string(), line: z.number().int().positive(), property: z.string() }),
    )
    .optional(),
});
export const TierHypothesisSchema = z.object({
  disagreementIds: z.array(z.string().min(1)).min(1),
  hypothesis: z.string(),
  tier: z.enum(['factual', 'interpretive']),
  tierReason: z.string(),
  gatedOn: z.literal('category').optional(),
});
export const VerifiedItemSchema = z.object({
  itemId: z.string().min(1),
  component: z.string().min(1),
  source: z.string().min(1),
  outcome: z.enum(['confirmed', 'resolved', 'conflicting']),
  resolved: z.array(z.object({ path: z.string().min(1), value: z.unknown() })).optional(),
  evidence: z.array(VerifyEvidenceSchema),
  reason: z.string(),
});
export const EvidenceCheckSchema = z.object({
  checkId: z.string().min(1),
  itemId: z.string().min(1),
  component: z.string().min(1),
  source: z.string().min(1),
  verdict: z.enum(['supports', 'does-not-support', 'unclear']),
  reason: z.string(),
});

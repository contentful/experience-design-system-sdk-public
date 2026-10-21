import { cdfJsonSchema } from '../../cdf/schema.js';
import { rewriteSchemaReferences } from '../../schema-export.js';
import { PROPERTY_BREAKING_REASONS, SLOT_BREAKING_REASONS } from './index.js';
import type { SchemaDescriptor } from '../../schema-export.js';
const object = (properties: SchemaDescriptor, required: string[] = []): SchemaDescriptor => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});
const array = (items: SchemaDescriptor): SchemaDescriptor => ({ type: 'array', items });
const ref = (name: string): SchemaDescriptor => ({ $ref: '#/$defs/' + name });
const opaque = {};
const componentFields = rewriteSchemaReferences(
  { properties: cdfJsonSchema.definitions.component.properties },
  {
    property: 'CDFProperty',
    slot: 'CDFSlot',
    modelBinding: 'CDFModelBinding',
    representationPlan: 'CDFRepresentationPlan',
  },
  '#/definitions/',
  '#/$defs/',
).properties as SchemaDescriptor;
export const previewContractSchemas: Readonly<Record<string, SchemaDescriptor>> = {
  ProposedComponentSummary: object({ ...componentFields, key: { type: 'string' }, definition: ref('CDFComponent') }),
  BreakingChange: {
    oneOf: [
      object({ propertyId: { type: 'string', minLength: 1 }, reason: { enum: [...PROPERTY_BREAKING_REASONS] } }, [
        'propertyId',
        'reason',
      ]),
      object({ slotId: { type: 'string', minLength: 1 }, reason: { enum: [...SLOT_BREAKING_REASONS] } }, [
        'slotId',
        'reason',
      ]),
    ],
  },
  PropertySummary: object(
    {
      type: { type: 'string' },
      category: { type: 'string' },
      required: { type: 'boolean' },
      default: opaque,
      definition: ref('CDFField'),
      targetDefinition: opaque,
      sourceDefinition: opaque,
      diagnostics: array(opaque),
    },
    ['type', 'category', 'required'],
  ),
  SlotSummary: object({
    definition: ref('CDFSlot'),
    targetDefinition: opaque,
    sourceDefinition: opaque,
    required: { type: 'boolean' },
    allowedComponents: array({ type: 'string' }),
    metadata: opaque,
  }),
  ProjectionDiagnostic: object(
    {
      componentId: { type: 'string' },
      propertyId: { type: 'string' },
      path: { type: 'string' },
      outcome: { enum: ['supported', 'conditional', 'lossy', 'unsupported'] },
      code: { type: 'string' },
      message: { type: 'string' },
    },
    ['componentId', 'propertyId', 'path', 'outcome', 'code', 'message'],
  ),
  ComponentTypeSummary: object(
    {
      id: { type: 'string' },
      name: { type: 'string' },
      contentProperties: array({ type: 'string' }),
      designProperties: array({ type: 'string' }),
      slots: array({ type: 'string' }),
      definition: opaque,
      sourceDefinition: opaque,
      fullProperties: { type: 'object', additionalProperties: ref('PropertySummary') },
      fullSlots: { type: 'object', additionalProperties: ref('SlotSummary') },
      currentSlotAllowed: { type: 'object', additionalProperties: array({ type: 'string' }) },
      projectionDiagnostics: array(ref('ProjectionDiagnostic')),
      deleteBlocked: object({ reason: { enum: ['fragment-referenced'] } }, ['reason']),
    },
    ['id', 'name', 'contentProperties', 'designProperties', 'slots'],
  ),
};

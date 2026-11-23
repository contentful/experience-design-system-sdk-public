export const SAME_SPACE_RESOURCE_SOURCE = 'crn:contentful:::content:spaces/$self/environments/$self';

export const allowedResourcesJsonSchema = {
  type: 'array',
  minItems: 1,
  items: {
    type: 'object',
    required: ['type', 'source'],
    properties: {
      type: { enum: ['Contentful:Entry', 'Contentful:Asset'] },
      source: { const: SAME_SPACE_RESOURCE_SOURCE },
      allowedTypes: { type: 'array', items: { type: 'string' } },
    },
    allOf: [
      {
        if: { properties: { type: { const: 'Contentful:Entry' } } },
        then: { required: ['allowedTypes'] },
        else: { not: { required: ['allowedTypes'] } },
      },
    ],
    additionalProperties: false,
  },
} as const;

export const targetDefinitionMetadataJsonProperties = {
  id: { type: 'string' },
  name: { type: 'string' },
  description: { type: 'string' },
  required: { type: 'boolean' },
} as const;

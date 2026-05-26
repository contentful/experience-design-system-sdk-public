import { CDF_PROPERTY_TYPES, CDF_PROPERTY_CATEGORIES } from './vocabularies.js';

export const CDF_V1_SCHEMA_URL = 'https://contentful.com/schemas/cdf/v1';

export const cdfV1JsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: CDF_V1_SCHEMA_URL,
  title: 'CDF Component Definition Format v1',
  type: 'object',
  required: ['$schema'],
  properties: {
    $schema: { type: 'string', const: CDF_V1_SCHEMA_URL },
  },
  additionalProperties: { $ref: '#/definitions/groupOrComponent' },
  definitions: {
    groupOrComponent: {
      oneOf: [{ $ref: '#/definitions/component' }, { $ref: '#/definitions/group' }],
    },
    component: {
      type: 'object',
      required: ['$type', '$properties'],
      properties: {
        $type: { type: 'string', const: 'component' },
        $description: { type: 'string' },
        $properties: {
          type: 'object',
          additionalProperties: { $ref: '#/definitions/property' },
        },
        $slots: {
          type: 'object',
          additionalProperties: { $ref: '#/definitions/slot' },
        },
      },
      additionalProperties: false,
    },
    property: {
      type: 'object',
      required: ['$type', '$category'],
      properties: {
        $type: { type: 'string', enum: [...CDF_PROPERTY_TYPES] },
        $category: { type: 'string', enum: [...CDF_PROPERTY_CATEGORIES] },
        $description: { type: 'string' },
        $required: { type: 'boolean' },
        $default: {},
        $values: { type: 'array', items: { type: 'string' } },
        '$token.kind': { type: 'string' },
      },
      additionalProperties: false,
    },
    slot: {
      type: 'object',
      properties: {
        $description: { type: 'string' },
        $required: { type: 'boolean' },
        $allowedComponents: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
    group: {
      type: 'object',
      properties: { $description: { type: 'string' } },
      additionalProperties: { $ref: '#/definitions/groupOrComponent' },
    },
  },
} as const;

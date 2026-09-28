import { CDF_PROPERTY_TYPES, CDF_PROPERTY_CATEGORIES } from './vocabularies.js';
import { DESIGN_TOKEN_TYPES } from '../dtcg/token-types.js';

export const CDF_SCHEMA_URL = 'https://contentful.com/schemas/cdf';

/**
 * Components and design tokens live in one recursive tree. A leaf's `$type`
 * decides what it is ('component' vs. a DESIGN_TOKEN_TYPES member), so the
 * same `group` container can hold either kind side by side. There is no
 * separate manifest envelope — this document is the single file/wire
 * payload sent to preview/apply.
 */
export const cdfJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: CDF_SCHEMA_URL,
  title: 'CDF Component + Design Token Definition Format',
  type: 'object',
  required: ['$schema'],
  properties: {
    $schema: { type: 'string', const: CDF_SCHEMA_URL },
  },
  additionalProperties: { $ref: '#/definitions/groupOrEntry' },
  definitions: {
    groupOrEntry: {
      oneOf: [{ $ref: '#/definitions/component' }, { $ref: '#/definitions/token' }, { $ref: '#/definitions/group' }],
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
        '$token.allowed': { type: 'array', items: { type: 'string' } },
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
    token: {
      type: 'object',
      required: ['$type', '$value'],
      properties: {
        $type: { type: 'string', enum: [...DESIGN_TOKEN_TYPES] },
        $value: {},
        $description: { type: 'string' },
      },
      additionalProperties: false,
    },
    group: {
      type: 'object',
      properties: { $description: { type: 'string' } },
      additionalProperties: { $ref: '#/definitions/groupOrEntry' },
    },
  },
} as const;

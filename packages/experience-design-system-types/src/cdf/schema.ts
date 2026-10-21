import { TARGET_PROPERTY_TYPES } from '../property-contract/target-definition.js';
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
        $model: { $ref: '#/definitions/modelBinding' },
        $representationPlans: { type: 'object', additionalProperties: { $ref: '#/definitions/representationPlan' } },
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
        $values: { type: 'array', minItems: 1 },
        $items: { $ref: '#/definitions/field' },
        $fields: { type: 'object', minProperties: 1, additionalProperties: { $ref: '#/definitions/field' } },
        $sourceInput: { $ref: '#/definitions/sourceInput' },
        '$token.kind': { type: 'string' },
        '$token.allowed': { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
    field: {
      type: 'object',
      required: ['$type'],
      properties: {
        $type: { enum: [...CDF_PROPERTY_TYPES] },
        $category: { enum: [...CDF_PROPERTY_CATEGORIES] },
        $description: { type: 'string' },
        $required: { type: 'boolean' },
        $default: {},
        $values: { type: 'array', minItems: 1 },
        $items: { $ref: '#/definitions/field' },
        $fields: { type: 'object', minProperties: 1, additionalProperties: { $ref: '#/definitions/field' } },
        '$token.kind': { type: 'string' },
        '$token.allowed': { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
    sourceInput: {
      type: 'object',
      required: ['schemaVersion', 'componentId', 'componentDeclarationId', 'rootSymbolId', 'inputName', 'inputPath'],
      properties: {
        schemaVersion: { const: 1 },
        componentId: { type: 'string', minLength: 1 },
        componentDeclarationId: { type: 'string', minLength: 1 },
        rootSymbolId: { type: 'string', minLength: 1 },
        inputName: { type: 'string', minLength: 1 },
        inputPath: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
      },
      additionalProperties: false,
    },
    modelBinding: {
      type: 'object',
      required: ['planId', 'componentId', 'propertyId', 'nodeId'],
      properties: {
        planId: { type: 'string' },
        componentId: { type: 'string' },
        propertyId: { type: 'string' },
        nodeId: { type: 'string' },
      },
      additionalProperties: false,
    },
    modelCardinality: {
      type: 'object',
      required: ['min', 'max', 'ordered'],
      properties: {
        min: { type: 'integer', minimum: 0 },
        max: { type: ['integer', 'null'], minimum: 0 },
        ordered: { type: 'boolean' },
        tuplePosition: { type: 'integer', minimum: 0 },
        rest: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    targetDefinition: {
      type: 'object',
      required: ['type'],
      properties: {
        type: { enum: [...TARGET_PROPERTY_TYPES] },
        id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        required: { type: 'boolean' },
        values: { type: 'array', items: {} },
        defaultValue: {},
        items: { $ref: '#/definitions/targetDefinition' },
        fields: { type: 'object', additionalProperties: { $ref: '#/definitions/targetDefinition' } },
        allowedResources: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'source'],
            properties: { type: { enum: ['Entry', 'Asset'] }, source: { enum: ['same-space'] } },
            additionalProperties: false,
          },
        },
        value: {},
        valueType: { $ref: '#/definitions/targetDefinition' },
      },
      additionalProperties: false,
    },
    representationProposal: {
      type: 'object',
      required: [
        'componentId',
        'propertyId',
        'key',
        'name',
        'sourceRevision',
        'sourceNodeIds',
        'declaredConstraints',
        'provenConstraints',
        'observations',
        'judgment',
        'desiredType',
        'desiredDefinition',
      ],
      properties: {
        componentId: { type: 'string' },
        propertyId: { type: 'string' },
        key: { type: 'string' },
        name: { type: 'string' },
        sourceRevision: { type: 'string' },
        sourceNodeIds: { type: 'array', items: { type: 'string' } },
        declaredConstraints: {
          type: 'array',
          items: {
            type: 'object',
            required: ['nodeId', 'statement'],
            properties: { nodeId: { type: 'string' }, statement: { type: 'string' } },
            additionalProperties: false,
          },
        },
        provenConstraints: {
          type: 'array',
          items: {
            type: 'object',
            required: ['nodeId', 'statement'],
            properties: { nodeId: { type: 'string' }, statement: { type: 'string' } },
            additionalProperties: false,
          },
        },
        observations: {
          type: 'array',
          items: {
            type: 'object',
            required: ['nodeId', 'value'],
            properties: { nodeId: { type: 'string' }, value: {} },
            additionalProperties: false,
          },
        },
        judgment: { type: 'string' },
        desiredType: { enum: [...TARGET_PROPERTY_TYPES] },
        desiredDefinition: { $ref: '#/definitions/targetDefinition' },
      },
      additionalProperties: false,
    },
    representationPlan: {
      type: 'object',
      required: [
        'schemaVersion',
        'id',
        'kind',
        'identity',
        'sourceDigest',
        'contextDigest',
        'category',
        'defaultIntent',
        'models',
        'mappings',
        'issues',
        'sdkValid',
        'requirements',
      ],
      properties: {
        proposal: { $ref: '#/definitions/representationProposal' },
        schemaVersion: { const: 1 },
        id: { type: 'string' },
        kind: { enum: ['native', 'component-model'] },
        identity: {
          type: 'object',
          required: ['componentId', 'propertyId', 'key', 'sourceRevision', 'nodeId'],
          properties: {
            componentId: { type: 'string' },
            propertyId: { type: 'string' },
            key: { type: 'string' },
            sourceRevision: { type: 'string' },
            nodeId: { type: 'string' },
          },
          additionalProperties: false,
        },
        sourceDigest: { type: 'string' },
        contextDigest: { type: 'string' },
        category: { enum: [...CDF_PROPERTY_CATEGORIES] },
        defaultIntent: {
          oneOf: [
            {
              type: 'object',
              required: ['action'],
              properties: { action: { enum: ['absent', 'clear'] } },
              additionalProperties: false,
            },
            {
              type: 'object',
              required: ['action', 'value'],
              properties: { action: { const: 'set' }, value: {} },
              additionalProperties: false,
            },
          ],
        },
        sourceDefault: { type: 'object' },
        nativeDefinition: { $ref: '#/definitions/property' },
        models: {
          type: 'array',
          items: {
            type: 'object',
            required: ['key', 'nodeId', 'entry'],
            properties: {
              key: { type: 'string' },
              nodeId: { type: 'string' },
              entry: { $ref: '#/definitions/component' },
            },
            additionalProperties: false,
          },
        },
        attachment: {
          type: 'object',
          required: ['slot', 'definition'],
          properties: { slot: { type: 'string' }, definition: { $ref: '#/definitions/slot' } },
          additionalProperties: false,
        },
        mappings: {
          type: 'array',
          items: {
            type: 'object',
            required: ['nodeId', 'path', 'required', 'nullable', 'undefinable', 'disposition'],
            properties: {
              nodeId: { type: 'string' },
              path: { type: 'array', items: { type: 'object' } },
              required: { type: 'boolean' },
              nullable: { type: ['boolean', 'null'] },
              undefinable: { type: ['boolean', 'null'] },
              disposition: { enum: ['native-field', 'model', 'slot', 'reference', 'held'] },
              componentKey: { type: 'string' },
              field: { type: 'string' },
              slot: { type: 'string' },
              targetNodeId: { type: 'string' },
              reason: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path', 'message'],
            properties: { path: { type: 'string' }, message: { type: 'string' } },
            additionalProperties: false,
          },
        },
        sdkValid: { type: 'boolean' },
        requirements: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path', 'capability'],
            properties: { path: { type: 'string' }, capability: { type: 'string' } },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    slot: {
      type: 'object',
      properties: {
        $sourceInput: { $ref: '#/definitions/sourceInput' },
        $modelBinding: { $ref: '#/definitions/modelBinding' },
        $cardinality: { $ref: '#/definitions/modelCardinality' },
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

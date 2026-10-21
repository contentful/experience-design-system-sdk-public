import type { CDFFieldDefinition, CDFPropertyDefinition } from '../cdf/types.js';
import { validateCDFProperty, targetToCDF } from '../cdf/property-validation.js';
import { isSourceBoundRepresentation } from './source-representation.js';
import { cloneJson, own, type JsonValue } from './json-value.js';
import type { DefaultIntent } from './property-model.js';
import type { RepresentationProposalDraft } from './representation-proposal.js';

export interface ClassifiedPropertyCall {
  tool: 'classify_prop';
  prop: string;
  cdf_type?: string;
  cdf_category: 'content' | 'design' | 'state';
  values?: JsonValue[];
  token_kind?: string;
  required?: boolean;
  description?: string;
  default?: JsonValue;
  default_intent?: DefaultIntent;
  items?: CDFFieldDefinition;
  fields?: Record<string, CDFFieldDefinition>;
  source_revision?: string;
  source_node_id?: string;
  reason?: string;
  value?: JsonValue;
  valueType?: CDFFieldDefinition;
  allowedResources?: CDFFieldDefinition['allowedResources'];
  representation_proposal?: RepresentationProposalDraft;
}
export function classificationDefinition(call: ClassifiedPropertyCall): CDFPropertyDefinition {
  if (!call.cdf_type) throw new Error('Absent representation has no field definition');
  const definition: CDFPropertyDefinition = {
    ...(call.representation_proposal && isSourceBoundRepresentation(call.cdf_type)
      ? targetToCDF(call.representation_proposal.desiredDefinition)
      : {}),
    $type: (call.cdf_type === 'enum' ? 'string' : call.cdf_type) as CDFPropertyDefinition['$type'],
    $category: call.cdf_category,
  };
  if (typeof call.required === 'boolean') definition.$required = call.required;
  if (typeof call.description === 'string') definition.$description = call.description;
  if (call.items) definition.$items = cloneJson(call.items);
  if (call.fields) definition.$fields = cloneJson(call.fields);
  if (own(call, 'value')) definition.value = cloneJson(call.value!);
  if (call.valueType) definition.valueType = cloneJson(call.valueType);
  if (call.allowedResources) definition.allowedResources = cloneJson(call.allowedResources);
  if (call.values?.length && call.cdf_type !== 'token') definition.$values = cloneJson(call.values);
  if (call.token_kind && call.cdf_type === 'token') definition['$token.kind'] = call.token_kind;
  if (own(call, 'default')) definition.$default = cloneJson(call.default!);
  if (call.default_intent?.action === 'set') definition.$default = cloneJson(call.default_intent.value);
  if (call.default_intent?.action === 'clear') delete definition.$default;
  return definition;
}
export function parseClassificationMetadata(rec: Record<string, unknown>, call: ClassifiedPropertyCall): string[] {
  const issues: string[] = [];
  if (own(rec, 'items')) call.items = cloneJson(rec.items as CDFFieldDefinition);
  if (own(rec, 'fields')) call.fields = cloneJson(rec.fields as Record<string, CDFFieldDefinition>);
  if (own(rec, 'values')) {
    if (!Array.isArray(rec.values)) issues.push('values must be an array');
    else call.values = cloneJson(rec.values as JsonValue[]);
  }
  if (own(rec, 'default')) call.default = cloneJson(rec.default as JsonValue);
  if (own(rec, 'default_intent')) {
    const intent = rec.default_intent as DefaultIntent;
    if (
      !intent ||
      typeof intent !== 'object' ||
      !['absent', 'set', 'clear'].includes(intent.action) ||
      Object.keys(intent).some((key) => !['action', ...(intent.action === 'set' ? ['value'] : [])].includes(key)) ||
      (intent.action === 'set' && !own(intent, 'value')) ||
      own(rec, 'default')
    )
      issues.push('Invalid or conflicting default intent');
    else call.default_intent = cloneJson(intent);
  }
  if (typeof rec.source_revision === 'string') call.source_revision = rec.source_revision;
  if (typeof rec.source_node_id === 'string') call.source_node_id = rec.source_node_id;
  call.cdf_type = call.cdf_type === 'enum' ? 'string' : call.cdf_type;
  issues.push(
    ...validateCDFProperty(classificationDefinition(call)).issues.map((issue) => `${issue.path}: ${issue.message}`),
  );
  return issues;
}

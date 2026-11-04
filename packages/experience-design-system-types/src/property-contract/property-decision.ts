import type { CDFPropertyDefinition } from '../cdf/types.js';
import { cdfToTarget, targetToCDF, validateCDFProperty } from '../cdf/property-validation.js';
import { CDF_PROPERTY_CATEGORIES, CDF_PROPERTY_TYPES } from '../cdf/vocabularies.js';
import { finiteValuesIssue } from '../cdf/finite-values.js';
import type { RepresentationProposalDraft } from './representation-proposal.js';
import { isSourceBoundRepresentation } from './source-representation.js';
import { validateTargetDefinition, validateTargetValue } from './target-definition.js';
import { jsonValueIssue, jsonEqual, own, childPath, type JsonValue } from './json-value.js';

export interface PropertyDecisionIssue {
  path: string;
  message: string;
}

export interface PropertyDecisionRepresentations {
  /** Definitions and drafts admitted against their authoritative source context by the caller. */
  definition?: CDFPropertyDefinition;
  representationProposal?: RepresentationProposalDraft;
  sourceRequired?: boolean;
}

const DECISION_KEYS = new Set([
  'name',
  'type',
  'category',
  'required',
  'default',
  'values',
  'observedValues',
  'tokenKind',
  'tokenPaths',
  'description',
  'reasoning',
  'definition',
  'representationProposal',
]);

/** Validates decision metadata without deriving a source shape or certifying mapper readiness. */
export function validatePropertyDecisionMetadata(
  input: unknown,
  representations: PropertyDecisionRepresentations = {},
): PropertyDecisionIssue[] {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return [{ path: '', message: 'A property decision must be an object' }];
  const decision = input as Record<string, unknown>;
  const errors: PropertyDecisionIssue[] = [];
  const issue = (key: string, message: string) => errors.push({ path: childPath('', key), message });
  const present = (key: string) => Object.hasOwn(decision, key);
  for (const key of Object.keys(decision)) {
    if (!DECISION_KEYS.has(key)) issue(key, 'Unrecognized property decision metadata');
  }
  if (typeof decision.name !== 'string' || decision.name.trim().length === 0)
    issue('name', 'Property decisions require a nonempty name');
  if (present('category') && !CDF_PROPERTY_CATEGORIES.some((category) => category === decision.category))
    issue('category', 'Invalid property category');
  if (present('required') && typeof decision.required !== 'boolean') issue('required', 'required must be a boolean');
  for (const key of ['description', 'reasoning']) {
    if (present(key) && typeof decision[key] !== 'string') issue(key, `${key} must be a string`);
  }
  if (present('observedValues')) {
    if (!Array.isArray(decision.observedValues))
      issue('observedValues', 'observedValues must be an array of JSON values');
    else
      decision.observedValues.forEach((value, index) => {
        const invalid = jsonValueIssue(value, childPath('/observedValues', index));
        if (invalid) errors.push(invalid);
      });
  }
  const { definition, representationProposal: proposal } = representations;
  if (present('definition') && !definition) issue('definition', 'A complete admitted definition is required');
  if (present('representationProposal') && !proposal)
    issue('representationProposal', 'An admitted source-bound representation proposal is required');
  if (definition && proposal) issue('representationProposal', 'A decision cannot combine competing representations');

  if (!present('type') && !definition && !proposal) {
    for (const key of ['default', 'values', 'tokenKind', 'tokenPaths']) {
      if (present(key)) issue(key, 'A type-absent decision cannot include representation metadata');
    }
    if (typeof decision.reasoning !== 'string' || decision.reasoning.trim().length === 0)
      issue('reasoning', 'A type-absent decision requires nonempty reasoning');
    return errors;
  }
  if (present('type') && !CDF_PROPERTY_TYPES.some((type) => type === decision.type)) {
    issue(
      'type',
      decision.type === 'enum'
        ? 'obsolete type "enum"; use string, number, or boolean with native finite values'
        : 'Invalid property type',
    );
  }

  if (proposal) {
    if (decision.category !== 'content')
      issue('category', 'A content representation proposal requires content category');
    const desired = proposal.desiredDefinition;
    if (representations.sourceRequired !== undefined && (desired.required ?? false) !== representations.sourceRequired)
      issue('required', 'Representation proposal requiredness must match the current source property');
    const type = targetToCDF(desired).$type;
    if (present('type') && decision.type !== type) issue('type', 'type must match the representation proposal');
    if (present('required') && decision.required !== (desired.required ?? false))
      issue('required', 'required must match the representation proposal');
    for (const key of ['values', 'tokenKind', 'tokenPaths']) {
      if (present(key)) issue(key, 'Unrelated metadata cannot accompany a representation proposal');
    }
    if (present('default')) {
      const invalid = validateTargetDefinition({ ...desired, defaultValue: decision.default as JsonValue }).issues;
      if (invalid.length) issue('default', 'default must match the complete representation proposal');
      if (own(desired, 'defaultValue') && !jsonEqual(decision.default, desired.defaultValue))
        issue('default', 'default conflicts with the representation proposal');
    }
    return errors;
  }

  if (present('values')) {
    if (!Array.isArray(decision.values)) issue('values', 'Invalid finite values: values must be an array');
    else {
      const invalid = finiteValuesIssue(decision.type, decision.values);
      if (invalid) issue('values', `Invalid finite values: ${invalid.message}`);
    }
  }
  for (const key of ['tokenKind', 'tokenPaths']) {
    if (present(key) && decision.type !== 'token') issue(key, `${key} is only valid for token decisions`);
  }
  if (present('tokenKind') && (typeof decision.tokenKind !== 'string' || decision.tokenKind.trim().length === 0))
    issue('tokenKind', 'tokenKind must be a nonempty string');
  if (
    present('tokenPaths') &&
    (!Array.isArray(decision.tokenPaths) ||
      !decision.tokenPaths.every((value) => typeof value === 'string' && value.trim().length > 0))
  )
    issue('tokenPaths', 'tokenPaths must be an array of nonempty strings');
  if (typeof decision.type === 'string' && isSourceBoundRepresentation(decision.type))
    issue('type', `${String(decision.type)} requires a source-bound representation proposal`);
  if (decision.type === 'Literal' && !definition) issue('definition', 'Literal requires a complete representation');
  if (definition) {
    if (decision.type !== definition.$type || decision.category !== definition.$category)
      issue('definition', 'Complete definition type and category must match the decision');
  }
  if (!present('default')) return errors;
  if (definition) {
    errors.push(...validateTargetValue(cdfToTarget(definition), decision.default as JsonValue));
  } else if (decision.type === 'array' || decision.type === 'record') {
    // Flat inventory records root transport only; it cannot invent recursive fields.
    const matches =
      decision.type === 'array'
        ? Array.isArray(decision.default)
        : typeof decision.default === 'object' && decision.default !== null && !Array.isArray(decision.default);
    if (!matches) issue('default', 'default must match the declared container type');
    else {
      const invalid = jsonValueIssue(decision.default, '/default');
      if (invalid) errors.push(invalid);
    }
  } else {
    const parsed = validateCDFProperty({
      $type: decision.type,
      $category: decision.category ?? 'content',
      $default: decision.default,
      ...(present('values') ? { $values: decision.values } : {}),
    });
    if (!parsed.valid) issue('default', 'default must match the native property type and finite values');
  }
  return errors;
}

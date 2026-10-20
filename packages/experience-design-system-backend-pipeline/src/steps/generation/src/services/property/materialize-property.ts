import {
  classificationDefinition,
  childPath,
  validateCDFProperty,
  own,
  cloneJson,
  projectProperty,
  LOCAL_NATIVE_PROPERTY_PROFILE,
  deriveRepresentationAlternatives,
  type ClassifiedPropertyCall,
  type CDFPropertyDefinition,
  type PropertyModel,
  type PropertyProjection,
  type RepresentationAlternative,
  type JsonValue,
  type CDFFieldDefinition,
  type TargetDefinition,
} from '@contentful/experience-design-system-types';
import type { RawComponentDefinition } from '../../../../extraction/src/types/component.js';

export interface MaterializedProperty {
  definition: CDFPropertyDefinition;
  model?: PropertyModel;
  projection?: PropertyProjection;
  alternatives?: RepresentationAlternative[];
}
export function materializeProperty(
  component: RawComponentDefinition,
  call: ClassifiedPropertyCall,
  componentId = component.name,
): MaterializedProperty {
  const raw = component.props.find((prop) => prop.name === call.prop);
  if (!raw) throw new Error(`Unknown property '${call.prop}'`);
  const candidate = component.sourceCandidates?.find((candidate) => candidate.name === call.prop);
  const fact = candidate?.facts;
  const definition = classificationDefinition(call);
  if (!own(call, 'required')) definition.$required = fact?.declaredRequired ?? raw.required;
  if (!own(call, 'description') && raw.description !== undefined) definition.$description = raw.description;
  const intent =
    call.default_intent ??
    (own(call, 'default') ? { action: 'set' as const, value: call.default! } : { action: 'absent' as const });
  if (!own(definition, '$default') && intent.action === 'absent') {
    if (fact?.sourceDefault?.state === 'value' && own(fact.sourceDefault, 'value'))
      definition.$default = cloneJson(fact.sourceDefault.value!);
    else if (!fact && raw.defaultValue !== undefined) {
      if (definition.$type === 'boolean' && ['true', 'false'].includes(raw.defaultValue))
        definition.$default = raw.defaultValue === 'true';
      else if (definition.$type === 'number' && raw.defaultValue.trim() && Number.isFinite(Number(raw.defaultValue)))
        definition.$default = Number(raw.defaultValue);
      else if (['string', 'richtext', 'token', 'media', 'link'].includes(definition.$type))
        definition.$default = raw.defaultValue;
    }
  }
  const inheritRequired = (
    target: CDFPropertyDefinition | NonNullable<CDFPropertyDefinition['$items']>,
    source: NonNullable<NonNullable<typeof fact>['advisoryShape']>,
  ): void => {
    if (!own(target, '$required')) target.$required = source.$required;
    if (target.$items && source.$items) inheritRequired(target.$items, source.$items);
    if (target.$fields && source.$fields)
      for (const [key, field] of Object.entries(target.$fields))
        if (own(source.$fields, key)) inheritRequired(field, source.$fields[key]!);
  };
  if (fact?.advisoryShape) inheritRequired(definition, fact.advisoryShape);
  const validation = validateCDFProperty(definition);
  if (!validation.valid) throw new Error(validation.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
  if (!fact?.sourceGraph) return { definition };
  const sourceRevision = [
    ...new Set(
      [...fact.declarations, ...fact.sourceGraph.nodes.flatMap((node) => node.declarations)].map(
        (location) => `${location.canonicalPath ?? ''}:${location.textHash ?? ''}`,
      ),
    ),
  ]
    .sort()
    .join('|');
  if (call.source_revision !== undefined && call.source_revision !== sourceRevision)
    throw new Error('Stale property source revision');
  if (call.source_node_id !== undefined && call.source_node_id !== fact.sourceGraph.rootId)
    throw new Error('Stale property source node');
  const model: PropertyModel = {
    identity: {
      componentId,
      propertyId: JSON.stringify([componentId, call.prop]),
      key: call.prop,
      sourceRevision,
      nodeId: fact.sourceGraph.rootId,
    },
    source: {
      typeText: fact.sourceTypeText,
      graph: cloneJson(fact.sourceGraph),
      shape: cloneJson(fact.advisoryShape),
      ...(fact.sourceDefault ? { default: cloneJson(fact.sourceDefault) } : {}),
      observations: [],
      originalFacts: cloneJson(candidate) as unknown as JsonValue,
    },
    category: call.cdf_category,
    representation: cloneJson(definition),
    defaultIntent: intent,
  };
  // These capabilities describe this local CDF materializer, not remote mapper deployment.
  const capabilities: Record<string, 'enabled'> = Object.create(null);
  const context = (d: CDFPropertyDefinition | NonNullable<CDFPropertyDefinition['$items']>, path: string): void => {
    capabilities[`${path}:mapper`] = 'enabled';
    capabilities[`${path}:default`] = 'enabled';
    if (d.$items) context(d.$items, `${path}/items`);
    if (d.$fields)
      for (const [key, field] of Object.entries(d.$fields)) context(field, childPath(childPath(path, 'fields'), key));
  };
  context(definition, '');
  const projection = projectProperty(model, LOCAL_NATIVE_PROPERTY_PROFILE, { capabilities });
  const alternatives = deriveRepresentationAlternatives(model);
  if (projection.outcome === 'unsupported') {
    if (
      projection.issues.some(
        (issue) =>
          !['Native position unavailable; source retained', 'Source domain contains unrepresentable values'].includes(
            issue.message,
          ),
      )
    )
      throw new Error(
        `Invalid property projection: ${projection.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
      );
    return { definition, model, projection, alternatives };
  }
  // Apply only the eligible default outcome; full source and representation stay in the decision.
  const applyDefaults = (field: CDFFieldDefinition, target: TargetDefinition): void => {
    if (own(target, 'defaultValue')) field.$default = cloneJson(target.defaultValue!);
    else delete field.$default;
    if (field.$items && target.items) applyDefaults(field.$items, target.items);
    if (field.$fields && target.fields)
      for (const [key, child] of Object.entries(field.$fields)) applyDefaults(child, target.fields[key]!);
  };
  if (projection.target) applyDefaults(definition, projection.target);
  return { definition, model, projection, alternatives };
}

export class PropertyAdmissionError extends Error {
  constructor(public readonly property: MaterializedProperty) {
    super(`Property '${property.model?.identity.key ?? ''}' native position unavailable; source and analysis retained`);
    this.name = 'PropertyAdmissionError';
  }
}

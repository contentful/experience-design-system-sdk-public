import {
  classificationDefinition,
  childPath,
  validateCDFProperty,
  containsCDFDefinitionType,
  own,
  cloneJson,
  projectProperty,
  LOCAL_NATIVE_PROPERTY_PROFILE,
  deriveRepresentationAlternatives,
  deriveEditableRepresentationPlans,
  type RepresentationPlan,
  type ClassifiedPropertyCall,
  type CDFPropertyDefinition,
  type PropertyModel,
  type PropertyProjection,
  type RepresentationAlternative,
  type CDFFieldDefinition,
  type TargetDefinition,
  isSourceBoundRepresentation,
  cdfToTarget,
} from '@contentful/experience-design-system-types';
import { sourcePropertyModel } from './source-property-model.js';
import type { RawComponentDefinition } from '../../../../extraction/src/types/component.js';

export interface MaterializedProperty {
  definition: CDFPropertyDefinition | null;
  call?: ClassifiedPropertyCall;
  model?: PropertyModel;
  projection?: PropertyProjection;
  alternatives?: RepresentationAlternative[];
  representationPlans?: RepresentationPlan[];
}
export function materializeProperty(
  component: RawComponentDefinition,
  call: ClassifiedPropertyCall,
  componentId = component.name,
  options: { defaultAuthority?: PropertyModel['defaultAuthority'] } = {},
): MaterializedProperty {
  const raw = component.props.find((prop) => prop.name === call.prop);
  const candidate = component.sourceCandidates?.find((candidate) => candidate.name === call.prop);
  const fact = candidate?.facts;
  if (!raw && !candidate) throw new Error(`Unknown property '${call.prop}'`);
  if (call.null_handling && (!fact?.sourceGraph || !call.source_revision || !call.source_node_id))
    throw new Error('Null handling requires current compiler source evidence and source identity');
  const omitSourceNullDefault =
    fact?.sourceGraph?.nodes.find((node) => node.id === fact.sourceGraph!.rootId)?.required === false &&
    call.null_handling?.some(
      (judgment) => judgment.sourceNodeId === fact!.sourceGraph!.rootId && judgment.handling === 'omit-equivalent',
    );
  const definition = call.cdf_type ? classificationDefinition(call) : null;
  if (definition && !own(call, 'required')) definition.$required = fact?.declaredRequired ?? raw?.required ?? false;
  if (definition && !own(call, 'description') && raw?.description !== undefined)
    definition.$description = raw.description;
  const intent =
    call.default_intent ??
    (own(call, 'default') ? { action: 'set' as const, value: call.default! } : { action: 'absent' as const });
  if (
    definition &&
    !isSourceBoundRepresentation(definition.$type) &&
    !own(definition, '$default') &&
    intent.action === 'absent'
  ) {
    if (
      fact?.sourceDefault?.state === 'value' &&
      own(fact.sourceDefault, 'value') &&
      !(omitSourceNullDefault && fact.sourceDefault.value === null)
    )
      definition.$default = cloneJson(fact.sourceDefault.value!);
    else if (!fact && raw?.defaultValue !== undefined) {
      if (definition.$type === 'boolean' && ['true', 'false'].includes(raw.defaultValue))
        definition.$default = raw.defaultValue === 'true';
      else if (
        ['number', 'Integer'].includes(definition.$type) &&
        raw.defaultValue.trim() &&
        Number.isFinite(Number(raw.defaultValue))
      )
        definition.$default = Number(raw.defaultValue);
      else if (['string', 'richtext', 'token', 'media', 'link', 'DateTime'].includes(definition.$type))
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
  if (definition && fact?.advisoryShape) inheritRequired(definition, fact.advisoryShape);
  const validation = definition ? validateCDFProperty(definition) : { valid: true, issues: [] };
  if (!validation.valid) throw new Error(validation.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
  if (!fact?.sourceGraph) {
    if (definition?.$values) throw new Error('Finite constraints require current complete compiler source evidence');
    if (
      definition &&
      (['Integer', 'DateTime', 'Literal', 'RichText', 'JSON', 'ResourceLink'].includes(definition.$type) ||
        containsCDFDefinitionType(definition, 'DiscriminatedUnion'))
    )
      throw new Error('Richer representation requires current complete source evidence');
    return { definition, call: cloneJson(call) };
  }
  const sourceModel = sourcePropertyModel(component, call.prop, componentId)!;
  if (call.source_revision !== undefined && call.source_revision !== sourceModel.identity.sourceRevision)
    throw new Error('Stale property source revision');
  if (call.source_node_id !== undefined && call.source_node_id !== sourceModel.identity.nodeId)
    throw new Error('Stale property source node');
  const model: PropertyModel = {
    ...sourceModel,
    category: call.cdf_category,
    ...(definition ? { representation: cloneJson(definition) } : {}),
    ...(call.representation_proposal ? { representationProposal: cloneJson(call.representation_proposal) } : {}),
    ...(call.null_handling ? { nullHandling: cloneJson(call.null_handling) } : {}),
    defaultIntent: intent,
    defaultAuthority: options.defaultAuthority ?? 'generation',
  };
  // These capabilities describe this local CDF materializer, not remote mapper deployment.
  const capabilities: Record<string, 'enabled'> = Object.create(null);
  const context = (d: CDFPropertyDefinition | NonNullable<CDFPropertyDefinition['$items']>, path: string): void => {
    capabilities[`${path}:mapper`] = 'enabled';
    capabilities[`${path}:default`] = 'enabled';
    if (d.$items) context(d.$items, `${path}/items`);
    if (d.valueType) context(d.valueType as CDFPropertyDefinition, `${path}/valueType`);
    for (const [index, member] of (d.members ?? []).entries()) context(member, `${path}/members/${index}`);
    if (d.$fields)
      for (const [key, field] of Object.entries(d.$fields)) context(field, childPath(childPath(path, 'fields'), key));
  };
  if (definition) context(definition, '');
  const projection = projectProperty(model, LOCAL_NATIVE_PROPERTY_PROFILE, { capabilities });
  const alternatives = deriveRepresentationAlternatives(model);
  const representationPlans = deriveEditableRepresentationPlans(model, {
    ...(call.representation_proposal && definition
      ? {
          proposal: {
            ...cloneJson(call.representation_proposal),
            desiredDefinition: cdfToTarget(definition),
          },
        }
      : {}),
  });
  if (projection.outcome === 'unsupported') {
    if (
      projection.issues.some(
        (issue) =>
          ![
            'Native position unavailable; source retained',
            'Native source structure unavailable; source retained',
            'No representation decision',
            'Source domain contains unrepresentable values',
            'Source default unresolved; source retained',
            'Finite source domain is not enforced; source retained',
          ].includes(issue.message),
      )
    )
      throw new Error(
        `Invalid property projection: ${projection.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
      );
    return { definition, call: cloneJson(call), model, projection, alternatives, representationPlans };
  }
  // Apply only the eligible default outcome; full source and representation stay in the decision.
  const applyDefaults = (field: CDFFieldDefinition, target: TargetDefinition): void => {
    if (own(target, 'defaultValue')) field.$default = cloneJson(target.defaultValue!);
    else delete field.$default;
    if (field.$items && target.items) applyDefaults(field.$items, target.items);
    if (field.valueType && target.valueType) applyDefaults(field.valueType, target.valueType);
    if (field.members && target.members)
      field.members.forEach((member, index) => applyDefaults(member, target.members![index]!));
    if (field.$fields && target.fields)
      for (const [key, child] of Object.entries(field.$fields)) applyDefaults(child, target.fields[key]!);
  };
  if (definition && projection.target) applyDefaults(definition, projection.target);
  return { definition, call: cloneJson(call), model, projection, alternatives, representationPlans };
}

export class PropertyAdmissionError extends Error {
  constructor(public readonly property: MaterializedProperty) {
    super(`Property '${property.model?.identity.key ?? ''}' native position unavailable; source and analysis retained`);
    this.name = 'PropertyAdmissionError';
  }
}

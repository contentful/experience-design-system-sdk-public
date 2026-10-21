import {
  cloneJson,
  cdfToTarget,
  jsonEqual,
  own,
  type CDFPropertyDefinition,
  type ClassifiedPropertyCall,
  type DefaultIntent,
  type RepresentationProposalDraft,
} from '@contentful/experience-design-system-types';

/** Review may change descriptive metadata without changing the source-compatible value contract. */
export function reviewRepresentationProposal(
  definition: CDFPropertyDefinition,
  proposal?: RepresentationProposalDraft,
): RepresentationProposalDraft | undefined {
  if (!proposal) return;
  const desired = cdfToTarget(definition);
  const structural = cloneJson(desired);
  delete structural.description;
  const previous = cloneJson(proposal.desiredDefinition);
  delete previous.description;
  if (previous.required === undefined) delete structural.required;
  if (!jsonEqual(previous, structural))
    throw new Error('Edited source-bound value contract requires a new compatibility judgment');
  return { ...cloneJson(proposal), desiredDefinition: desired };
}

export function definitionCall(
  name: string,
  definition: CDFPropertyDefinition,
  intent?: DefaultIntent,
  proposal?: RepresentationProposalDraft,
): ClassifiedPropertyCall {
  return {
    tool: 'classify_prop',
    prop: name,
    cdf_type: definition.$type,
    cdf_category: definition.$category === 'unattached' ? 'content' : definition.$category,
    ...(own(definition, '$required') ? { required: definition.$required } : {}),
    ...(definition.$description === undefined ? {} : { description: definition.$description }),
    ...(definition.$items ? { items: cloneJson(definition.$items) } : {}),
    ...(definition.$fields ? { fields: cloneJson(definition.$fields) } : {}),
    ...(own(definition, 'value') ? { value: cloneJson(definition.value!) } : {}),
    ...(definition.valueType ? { valueType: cloneJson(definition.valueType) } : {}),
    ...(definition.allowedResources ? { allowedResources: cloneJson(definition.allowedResources) } : {}),
    ...(proposal ? { representation_proposal: cloneJson(proposal) } : {}),
    ...(definition.$values ? { values: cloneJson(definition.$values) } : {}),
    ...(definition['$token.kind'] ? { token_kind: definition['$token.kind'] } : {}),
    ...(intent
      ? { default_intent: cloneJson(intent) }
      : own(definition, '$default')
        ? { default: cloneJson(definition.$default!) }
        : {}),
  };
}

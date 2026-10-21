import {
  cloneJson,
  own,
  type CDFPropertyDefinition,
  type ClassifiedPropertyCall,
  type DefaultIntent,
} from '@contentful/experience-design-system-types';

export function definitionCall(
  name: string,
  definition: CDFPropertyDefinition,
  intent?: DefaultIntent,
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
    ...(definition.$values ? { values: cloneJson(definition.$values) } : {}),
    ...(definition['$token.kind'] ? { token_kind: definition['$token.kind'] } : {}),
    ...(intent
      ? { default_intent: cloneJson(intent) }
      : own(definition, '$default')
        ? { default: cloneJson(definition.$default!) }
        : {}),
  };
}

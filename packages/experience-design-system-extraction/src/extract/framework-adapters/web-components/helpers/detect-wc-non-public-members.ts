export function hasInternalJsDocTag(member: { getJsDocs(): import('ts-morph').JSDoc[] }): boolean {
  return member.getJsDocs().some((doc) => doc.getTags().some((tag) => tag.getTagName() === 'internal'));
}

export const NON_PUBLIC_LIT_DECORATORS = new Set(['consume', 'provide', 'query', 'queryAsync', 'state']);
export const INTERNAL_RUNTIME_FIELD_NAMES = new Set(['dir', 'initialReflectedProperties', 'lang']);

export function isNonPublicLitMember(member: { getDecorators(): import('ts-morph').Decorator[] }): boolean {
  return member.getDecorators().some((decorator) => NON_PUBLIC_LIT_DECORATORS.has(decorator.getName()));
}

export function isInternalRuntimeField(name: string, applyRuntimeFieldDenylist: boolean): boolean {
  return applyRuntimeFieldDenylist && INTERNAL_RUNTIME_FIELD_NAMES.has(name);
}

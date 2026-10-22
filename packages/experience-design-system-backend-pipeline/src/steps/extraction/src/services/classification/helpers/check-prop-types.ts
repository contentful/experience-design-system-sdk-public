/** Primitive-type predicates used by the classification rule engine. */

export function isStringLiteralUnion(type: string): boolean {
  return type.includes('|') && type.includes("'");
}

export function isSimpleType(type: string): boolean {
  const t = type.trim();
  if (t === 'string' || t === 'boolean' || t === 'number') return true;
  return isStringLiteralUnion(t);
}

export function isBooleanType(type: string): boolean {
  return type.trim() === 'boolean';
}

export function isStringType(type: string): boolean {
  return type.trim() === 'string';
}

export function isNumberType(type: string): boolean {
  return type.trim() === 'number';
}

export function isComplexType(type: string): boolean {
  return !isSimpleType(type);
}

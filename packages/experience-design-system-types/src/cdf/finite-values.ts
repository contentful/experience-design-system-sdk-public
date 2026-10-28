export type FinitePrimitiveValue = string | number | boolean;
export type FinitePrimitiveType = 'string' | 'number' | 'boolean';

export function isFinitePrimitiveType(type: unknown): type is FinitePrimitiveType {
  return type === 'string' || type === 'number' || type === 'boolean';
}

export function isFinitePrimitiveValue(value: unknown): value is FinitePrimitiveValue {
  return (
    typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
  );
}

export function finiteValuesIssue(
  type: unknown,
  values: readonly unknown[],
): { index?: number; message: string } | undefined {
  if (!isFinitePrimitiveType(type)) return { message: '$values is only valid for string, number, or boolean types' };
  if (values.length === 0) return { message: '$values must contain at least one value' };
  const seen = new Set<FinitePrimitiveValue>();
  for (const [index, value] of values.entries()) {
    if (!isFinitePrimitiveValue(value) || typeof value !== type)
      return { index, message: `Each $values member must match the ${type} type` };
    if (seen.has(value)) return { index, message: '$values must not contain duplicate values' };
    seen.add(value);
  }
  return undefined;
}

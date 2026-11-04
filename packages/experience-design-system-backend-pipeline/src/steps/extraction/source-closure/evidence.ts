import type { ClosureFact, ClosureProofStrength } from './types.js';
const strengthOrder: Record<ClosureProofStrength, number> = { exact: 0, inferred: 1, unknown: 2 };
/** Only dependencies actually used to derive this value contribute uncertainty. */
export function deriveClosureFact<Value>(
  value: Value,
  dependencies: readonly ClosureFact[] = [],
  own: Partial<Omit<ClosureFact<Value>, 'value'>> = {},
): ClosureFact<Value> {
  let strength = own.strength ?? 'exact';
  for (const dependency of dependencies)
    if (strengthOrder[dependency.strength] > strengthOrder[strength]) strength = dependency.strength;
  return {
    value,
    strength,
    dependsOnOpenEnd: (own.dependsOnOpenEnd ?? false) || dependencies.some((fact) => fact.dependsOnOpenEnd),
    provenance: [...new Set([...(own.provenance ?? []), ...dependencies.flatMap((fact) => fact.provenance)])].sort(),
  };
}
/** Immutable acyclic primitives, arrays, maps, sets and plain records are supported. */
export function closureValueEqual(left: unknown, right: unknown): boolean {
  return valueKey(left, new Set()) === valueKey(right, new Set());
}
function valueKey(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return `number:${Object.is(value, -0) ? '-0' : value}`;
  if (typeof value !== 'object') throw new TypeError('Unsupported closure fact value');
  if (ancestors.has(value)) throw new TypeError('Closure fact values must be acyclic');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return `array:${JSON.stringify(value.map((entry) => valueKey(entry, ancestors)))}`;
    if (value instanceof Map)
      return `map:${JSON.stringify([...value].map(([key, entry]) => [valueKey(key, ancestors), valueKey(entry, ancestors)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))}`;
    if (value instanceof Set)
      return `set:${JSON.stringify([...value].map((entry) => valueKey(entry, ancestors)).sort())}`;
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      throw new TypeError('Unsupported closure fact value prototype');
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError('Unsupported closure fact value keys');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return `record:${JSON.stringify(
      Object.keys(descriptors)
        .sort()
        .map((key) => {
          const descriptor = descriptors[key]!;
          if (!('value' in descriptor)) throw new TypeError('Unsupported closure fact value accessor');
          return [key, valueKey(descriptor.value, ancestors)];
        }),
    )}`;
  } finally {
    ancestors.delete(value);
  }
}

export function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    keys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}
export const sourceText = (value: unknown): value is string => typeof value === 'string';
export const sourceStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(sourceText);
export const sourceArray = (value: unknown, validate: (item: unknown) => boolean): boolean =>
  Array.isArray(value) && value.every(validate);
export const sourceCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const sourceScalar = (value: unknown): value is string | number | boolean | null =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)));

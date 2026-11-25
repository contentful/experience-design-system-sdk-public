type RecordValue = Record<string, unknown>;
function plain(value: unknown): value is RecordValue {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
function json(value: unknown, active = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if ((!plain(value) && !Array.isArray(value)) || active.has(value)) return false;
  active.add(value);
  try {
    if (Object.getOwnPropertySymbols(value).length) return false;
    if (
      Array.isArray(value) &&
      (Object.keys(value).length !== value.length ||
        Object.keys(value).some(
          (key) =>
            !Number.isSafeInteger(Number(key)) ||
            Number(key) < 0 ||
            Number(key) >= value.length ||
            String(Number(key)) !== key,
        ))
    )
      return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Object.entries(descriptors).every(([key, descriptor]) =>
      Array.isArray(value) && key === 'length'
        ? true
        : 'value' in descriptor && descriptor.enumerable === true && json(descriptor.value, active),
    );
  } finally {
    active.delete(value);
  }
}
export { json as isPlainSourceContract };

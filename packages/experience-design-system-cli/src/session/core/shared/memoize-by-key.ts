// Wraps a two-argument lookup so repeated calls with the same (a, b) tuple
// return the cached first result instead of re-running the lookup. The cache
// key is `${a}::${b}` so the two arguments must serialize unambiguously to
// strings — designed for identifier arguments (component IDs, positions).
export function memoizeByKey<A extends string | number, B extends string | number, R>(
  lookup: (a: A, b: B) => R,
): (a: A, b: B) => R {
  const cache = new Map<string, R>();
  return (a, b) => {
    const key = `${a}::${b}`;
    if (cache.has(key)) return cache.get(key) as R;
    const value = lookup(a, b);
    cache.set(key, value);
    return value;
  };
}

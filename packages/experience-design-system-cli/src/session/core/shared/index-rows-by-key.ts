/**
 * Build a `Map<key, T[]>` from a flat array. Used to reassemble parent/child
 * rows read from separate SQL queries — e.g. bucket all `raw_props` rows by
 * their parent `component_id` before stitching them onto their components.
 */
export function indexRowsByKey<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    let arr = map.get(k);
    if (!arr) {
      arr = [];
      map.set(k, arr);
    }
    arr.push(item);
  }
  return map;
}

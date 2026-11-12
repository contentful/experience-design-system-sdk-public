// How the import debug logs list components and tokens by name. A project can have hundreds of components and thousands of
// tokens, so a list is cut: the Summary shows the first few for a person to read, and Data keeps many more for AI, with a
// flag when even that was cut. The count is always the full count.

/** How many names a list shows in the Summary. */
export const SUMMARY_NAMES = 20;

/** How many names a list keeps in Data. */
export const DATA_NAMES = 300;

export type NameList = { count: number; names: string[]; truncated?: true };

/** The unique names, sorted, as data. */
export function nameList(names: Iterable<string>): NameList {
  const unique = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  return {
    count: unique.length,
    names: unique.slice(0, DATA_NAMES),
    ...(unique.length > DATA_NAMES ? { truncated: true as const } : {}),
  };
}

/**
 * A label with its count and its first names as Summary lines. `indent` is how many levels the label is nested, and
 * `countText` replaces the number after the label when a step has something more exact to say about it.
 */
export function nameLines(label: string, list: NameList, indent = 0, countText?: string): string[] {
  const pad = '  '.repeat(indent);
  return [
    `${pad}${label}: ${countText ?? list.count}`,
    ...list.names.slice(0, SUMMARY_NAMES).map((name) => `${pad}  ${name}`),
    ...(list.count > SUMMARY_NAMES ? [`${pad}  …and ${list.count - SUMMARY_NAMES} more`] : []),
  ];
}

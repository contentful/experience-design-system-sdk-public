export interface TokenRow {
  /** Dot-separated DTCG path, e.g. `color.brand.primary`. */
  path: string;
  type: string;
  value: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * The tokens of a DTCG tree, in file order. A node with `$value` is a token; any other node is a group whose children are
 * walked. A token without its own `$type` takes the nearest group's.
 */
export function flattenTokens(tree: unknown): TokenRow[] {
  const rows: TokenRow[] = [];
  const walk = (node: Record<string, unknown>, path: string[], inheritedType: string): void => {
    const type = typeof node['$type'] === 'string' ? node['$type'] : inheritedType;
    if ('$value' in node) {
      rows.push({ path: path.join('.'), type: type || '-', value: formatValue(node['$value']) });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (!key.startsWith('$') && isRecord(child)) walk(child, [...path, key], type);
    }
  };
  if (isRecord(tree)) walk(tree, [], '');
  return rows;
}

/** The longest token name and value, which a side-by-side listing needs room for. */
export function longestEntries(rows: readonly TokenRow[]): { path: number; value: number } {
  return {
    path: Math.max(0, ...rows.map((row) => row.path.length)),
    value: Math.max(0, ...rows.map((row) => row.value.length)),
  };
}

/** The rows to draw: a window of `visibleCount` around the cursor, and how many rows are cut off above and below. */
export function computeColumnWindow(
  total: number,
  cursor: number,
  visibleCount: number,
): { start: number; end: number; above: number; below: number } {
  if (total <= visibleCount) return { start: 0, end: total, above: 0, below: 0 };
  let start = Math.max(0, cursor - Math.floor(visibleCount / 2));
  start = Math.min(start, total - visibleCount);
  const end = start + visibleCount;
  return { start, end, above: start, below: total - end };
}

export const TOKEN_REVIEW_CONTROLS = [
  { keys: '↑/↓', label: 'Scroll' },
  { keys: 'Enter', label: 'Continue' },
  { keys: 'Esc', label: 'Quit' },
] as const;

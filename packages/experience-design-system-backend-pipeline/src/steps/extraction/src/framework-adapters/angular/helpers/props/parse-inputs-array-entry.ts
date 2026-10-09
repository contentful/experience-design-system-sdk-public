export interface ParsedInputsArrayEntry {
  fieldName: string;
  alias: string | null;
}

/**
 * Parse one entry of the legacy `@Component({ inputs: ['foo', 'bar: alias'] })`.
 * Grammar: `fieldName` or `fieldName: aliasName`. Returns `null` for malformed
 * entries (empty strings, more than one colon).
 */
export function parseInputsArrayEntry(entry: string): ParsedInputsArrayEntry | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':');
  if (parts.length === 1) {
    return { fieldName: parts[0]!.trim(), alias: null };
  }
  if (parts.length === 2) {
    const field = parts[0]!.trim();
    const alias = parts[1]!.trim();
    if (!field || !alias) return null;
    return { fieldName: field, alias };
  }
  return null;
}

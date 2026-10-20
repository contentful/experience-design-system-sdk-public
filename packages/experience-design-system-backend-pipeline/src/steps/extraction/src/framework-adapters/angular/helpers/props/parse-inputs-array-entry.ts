export interface ParsedInputsArrayEntry {
  fieldName: string;
  alias: string | null;
}

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

const PROMPT_FILE_EXTENSIONS = ['.md', '.txt', '.prompt'];

/** String-shape heuristic: contains a separator, starts with `~`, or ends with a known prompt-file extension. */
export function looksLikePath(value: string): boolean {
  if (value.includes('/') || value.includes('\\')) return true;
  if (value.startsWith('~')) return true;
  const lower = value.toLowerCase();
  return PROMPT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

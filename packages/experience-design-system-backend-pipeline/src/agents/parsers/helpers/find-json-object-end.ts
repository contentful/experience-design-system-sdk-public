/**
 * Return the index of the `}` that closes the first balanced JSON object
 * starting at the first `{` on this line. Returns -1 when the line never
 * closes a balanced object.
 */
export function findJsonObjectEnd(line: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (escaped) {
      escaped = false;
    } else if (ch === '\\' && inString) {
      escaped = true;
    } else if (ch === '"') {
      inString = !inString;
    } else if (!inString && ch === '{') {
      depth++;
    } else if (!inString && ch === '}' && --depth === 0) {
      return i;
    }
  }

  return -1;
}

const SAFE_PATH_RE = /^[a-zA-Z0-9_.$[\]=]+$/;
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface ApplyDotPathResult {
  warnings: string[];
}

/**
 * Sets `obj[path] = value` using dot-notation with array `[name=X]` segments.
 * Rejects unsafe paths and forbidden __proto__-style keys; collects warnings
 * instead of writing to stderr.
 */
export function applyDotPath(obj: Record<string, unknown>, path: string, value: unknown): ApplyDotPathResult {
  const warnings: string[] = [];
  if (!SAFE_PATH_RE.test(path)) {
    warnings.push(`--patch path contains invalid characters: '${path}', skipped`);
    return { warnings };
  }
  const parts = path.split('.');
  if (parts.some((p) => PROTO_KEYS.has(p))) {
    warnings.push(`--patch path contains forbidden key: '${path}', skipped`);
    return { warnings };
  }
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i] as string;
    const arrayMatch = /^(.+)\[name=(.+)\]$/.exec(part);
    if (arrayMatch) {
      const [, fieldName, matchValue] = arrayMatch;
      const arr = current[fieldName as string] as Array<Record<string, unknown>>;
      if (Array.isArray(arr)) {
        const item = arr.find((el) => el['name'] === matchValue);
        if (item) {
          current = item;
        } else {
          warnings.push(`--patch array item [name=${matchValue}] not found in '${fieldName}', skipped`);
          return { warnings };
        }
      }
    } else {
      if (typeof current[part] !== 'object' || current[part] === null) {
        warnings.push(`--patch path '${path}' — '${part}' is not an object, skipped`);
        return { warnings };
      }
      current = current[part] as Record<string, unknown>;
    }
  }
  const lastPart = parts[parts.length - 1] as string;
  current[lastPart] = value;
  return { warnings };
}

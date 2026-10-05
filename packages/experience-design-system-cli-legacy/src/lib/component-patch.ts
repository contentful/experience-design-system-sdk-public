export type ComponentPatchOperation = {
  component: string;
  status?: string;
  set?: Record<string, unknown>;
};

const SAFE_PATH_RE = /^[a-zA-Z0-9_.$[\]=]+$/;
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function applyDotPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  if (!SAFE_PATH_RE.test(path)) {
    process.stderr.write(`Warning: --patch path contains invalid characters: '${path}', skipping\n`);
    return;
  }
  const parts = path.split('.');
  if (parts.some((p) => PROTO_KEYS.has(p))) {
    process.stderr.write(`Warning: --patch path contains forbidden key: '${path}', skipping\n`);
    return;
  }
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const arrayMatch = /^(.+)\[name=(.+)\]$/.exec(part);
    if (arrayMatch) {
      const [, fieldName, matchValue] = arrayMatch;
      const arr = current[fieldName!] as Array<Record<string, unknown>>;
      if (Array.isArray(arr)) {
        const item = arr.find((el) => el['name'] === matchValue);
        if (item) {
          current = item;
        } else {
          process.stderr.write(
            `Warning: --patch array item [name=${matchValue}] not found in '${fieldName}', skipping\n`,
          );
          return;
        }
      }
    } else {
      if (typeof current[part] !== 'object' || current[part] === null) {
        process.stderr.write(`Warning: --patch path '${path}' — '${part}' is not an object, skipping\n`);
        return;
      }
      current = current[part] as Record<string, unknown>;
    }
  }
  const lastPart = parts[parts.length - 1]!;
  current[lastPart] = value;
}

export function applyComponentPatch<T extends { name: string }>(
  components: T[],
  operations: ComponentPatchOperation[],
  applySet: (component: T, values: Record<string, unknown>) => T,
): T[] {
  return components.map((component) => {
    const operation = operations.find((candidate) => candidate.component === component.name);
    if (!operation) return component;

    let updated = component;
    if (operation.status) updated = { ...updated, status: operation.status } as T;
    if (operation.set) updated = applySet(updated, operation.set);
    return updated;
  });
}

export function warnOnUnknownPatchComponents<T extends { name: string }>(
  components: T[],
  operations: ComponentPatchOperation[],
): void {
  const knownNames = new Set(components.map((component) => component.name));
  for (const operation of operations) {
    if (!knownNames.has(operation.component)) {
      process.stderr.write(`Warning: --patch targets unknown component '${operation.component}', skipping\n`);
    }
  }
}

function createComponentIdResolver(existingIds: readonly string[]): (id: string) => string {
  const exactIds = new Set(existingIds);
  const idsByLowercase = new Map<string, Set<string>>();
  for (const id of exactIds) {
    const lowercase = id.toLowerCase();
    const ids = idsByLowercase.get(lowercase) ?? new Set<string>();
    ids.add(id);
    idsByLowercase.set(lowercase, ids);
  }

  return (id) => {
    const matches = idsByLowercase.get(id.toLowerCase());
    return !exactIds.has(id) && matches?.size === 1 ? [...matches][0]! : id;
  };
}

/** Exact IDs win; a case-insensitive match is used only when it identifies one existing ID. */
export function resolveComponentIds(
  generatedIds: readonly string[],
  existingIds: readonly string[],
): Map<string, string> {
  const resolveId = createComponentIdResolver(existingIds);
  const resolved = new Map<string, string>();
  const sourcesByTarget = new Map<string, string[]>();
  for (const id of new Set(generatedIds)) {
    const target = resolveId(id);
    resolved.set(id, target);
    const sources = sourcesByTarget.get(target) ?? [];
    sources.push(id);
    sourcesByTarget.set(target, sources);
  }

  // A case fallback must never overwrite another generated definition.
  for (const sources of sourcesByTarget.values()) {
    if (sources.length > 1) {
      for (const id of sources) resolved.set(id, id);
    }
  }
  return resolved;
}

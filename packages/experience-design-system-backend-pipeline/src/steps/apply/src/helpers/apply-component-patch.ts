export interface ComponentPatchOperation {
  component: string;
  status?: string;
  set?: Record<string, unknown>;
}

/**
 * Applies a patch set onto a list of components (keyed by `.name`). The
 * `applySet` callback knows how to merge an operation's `set` payload into
 * one component — kept callback-shaped so the function stays pure and the
 * CDF-shape-specific merge logic lives at the call site.
 */
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

import type { ComponentPatchOperation } from './apply-component-patch.js';

/**
 * Returns one warning string per patch operation that targets a component
 * not present in the input list. Callers decide where to emit warnings.
 */
export function warnOnUnknownPatchComponents<T extends { name: string }>(
  components: T[],
  operations: ComponentPatchOperation[],
): string[] {
  const warnings: string[] = [];
  const knownNames = new Set(components.map((c) => c.name));
  for (const operation of operations) {
    if (!knownNames.has(operation.component)) {
      warnings.push(`--patch targets unknown component '${operation.component}', skipped`);
    }
  }
  return warnings;
}

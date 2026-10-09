import { applyComponentPatch as impl, type ComponentPatchOperation } from '../../helpers/apply-component-patch.js';

export type { ComponentPatchOperation };

export interface MutateCdfComponentRequest<T extends { name: string }> {
  components: T[];
  operations: ComponentPatchOperation[];
  applySet: (component: T, values: Record<string, unknown>) => T;
}

export function mutateCdfComponent<T extends { name: string }>(request: MutateCdfComponentRequest<T>): T[] {
  return impl(request.components, request.operations, request.applySet);
}

// Legacy-name alias used by cli-legacy call sites — remove after TUI swap.
export { mutateCdfComponent as applyComponentPatch };
export type { MutateCdfComponentRequest as ApplyComponentPatchRequest };

import { applyComponentPatch as impl, type ComponentPatchOperation } from '../helpers/apply-component-patch.js';

export type { ComponentPatchOperation };

export interface ApplyComponentPatchRequest<T extends { name: string }> {
  components: T[];
  operations: ComponentPatchOperation[];
  applySet: (component: T, values: Record<string, unknown>) => T;
}

export function applyComponentPatch<T extends { name: string }>(request: ApplyComponentPatchRequest<T>): T[] {
  return impl(request.components, request.operations, request.applySet);
}
